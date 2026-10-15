use std::io::{self, Read};
use std::time::Duration;

pub struct Response {
    pub status: u16,
    pub content_range: Option<String>,
    pub body: Box<dyn Read>,
}

#[cfg(windows)]
pub fn get(
    url: &str,
    range: Option<&str>,
    accept: Option<&str>,
    timeout: Duration,
) -> Result<Response, String> {
    native::get(url, range, accept, timeout).map_err(|error| format!("更新网络请求失败：{error}"))
}

#[cfg(not(windows))]
pub fn get(
    url: &str,
    range: Option<&str>,
    accept: Option<&str>,
    timeout: Duration,
) -> Result<Response, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(timeout)
        .timeout_read(timeout)
        .build();
    let mut request = agent
        .get(url)
        .set("User-Agent", "md-king-updater")
        .set("Accept-Encoding", "identity");
    if let Some(range) = range {
        request = request.set("Range", range);
    }
    if let Some(accept) = accept {
        request = request.set("Accept", accept);
    }
    let response = match request.call() {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(error) => return Err(error.to_string()),
    };
    Ok(Response {
        status: response.status(),
        content_range: response.header("Content-Range").map(str::to_owned),
        body: response.into_reader(),
    })
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Networking::WinHttp::*;

    struct Handle(*mut c_void);
    impl Handle {
        fn new(pointer: *mut c_void) -> io::Result<Self> {
            if pointer.is_null() {
                Err(io::Error::last_os_error())
            } else {
                Ok(Self(pointer))
            }
        }
    }
    impl Drop for Handle {
        fn drop(&mut self) {
            // Each handle is owned exactly once and outlives its dependent request.
            unsafe {
                WinHttpCloseHandle(self.0);
            }
        }
    }
    struct Body {
        // Rust drops fields in declaration order: request, connection, then session.
        request: Handle,
        _connection: Handle,
        _session: Handle,
    }
    impl Read for Body {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if buffer.is_empty() {
                return Ok(0);
            }
            let mut read = 0;
            // WinHTTP writes at most the supplied buffer capacity; the handle stays live.
            if unsafe {
                WinHttpReadData(
                    self.request.0,
                    buffer.as_mut_ptr().cast(),
                    buffer.len().min(u32::MAX as usize) as u32,
                    &mut read,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(read as usize)
        }
    }
    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }
    fn check(success: i32) -> io::Result<()> {
        if success == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    pub fn get(
        url: &str,
        range: Option<&str>,
        accept: Option<&str>,
        timeout: Duration,
    ) -> io::Result<Response> {
        let encoded_url = wide(url);
        let mut parts = URL_COMPONENTS {
            dwStructSize: size_of::<URL_COMPONENTS>() as u32,
            dwHostNameLength: u32::MAX,
            dwUrlPathLength: u32::MAX,
            dwExtraInfoLength: u32::MAX,
            ..Default::default()
        };
        // CrackUrl borrows slices of encoded_url; copy them before that buffer can be dropped.
        check(unsafe {
            WinHttpCrackUrl(
                encoded_url.as_ptr(),
                (encoded_url.len() - 1) as u32,
                0,
                &mut parts,
            )
        })?;
        if (parts.nScheme != WINHTTP_INTERNET_SCHEME_HTTPS
            && parts.nScheme != WINHTTP_INTERNET_SCHEME_HTTP)
            || parts.dwHostNameLength == 0
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "更新地址必须使用 HTTP(S)",
            ));
        }
        let mut host = unsafe {
            std::slice::from_raw_parts(parts.lpszHostName, parts.dwHostNameLength as usize)
        }
        .to_vec();
        host.push(0);
        let mut path = Vec::new();
        if parts.dwUrlPathLength > 0 {
            path.extend_from_slice(unsafe {
                std::slice::from_raw_parts(parts.lpszUrlPath, parts.dwUrlPathLength as usize)
            });
        } else {
            path.push(b'/' as u16);
        }
        if parts.dwExtraInfoLength > 0 {
            path.extend_from_slice(unsafe {
                std::slice::from_raw_parts(parts.lpszExtraInfo, parts.dwExtraInfoLength as usize)
            });
        }
        path.push(0);
        let user_agent = wide("md-king-updater");
        // AUTOMATIC_PROXY follows current-user/system settings, including PAC and bypass rules.
        let session = Handle::new(unsafe {
            WinHttpOpen(
                user_agent.as_ptr(),
                WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                null(),
                null(),
                0,
            )
        })?;
        let millis = timeout.as_millis().min(i32::MAX as u128) as i32;
        check(unsafe { WinHttpSetTimeouts(session.0, millis, millis, millis, millis) })?;
        let http2 = WINHTTP_PROTOCOL_FLAG_HTTP2;
        // HTTP/2 is negotiated when available; local HTTP test servers still use HTTP/1.1.
        check(unsafe {
            WinHttpSetOption(
                session.0,
                WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL,
                (&http2 as *const u32).cast(),
                size_of::<u32>() as u32,
            )
        })?;
        let connection =
            Handle::new(unsafe { WinHttpConnect(session.0, host.as_ptr(), parts.nPort, 0) })?;
        let verb = wide("GET");
        let flags = if parts.nScheme == WINHTTP_INTERNET_SCHEME_HTTPS {
            WINHTTP_FLAG_SECURE
        } else {
            0
        };
        let request = Handle::new(unsafe {
            WinHttpOpenRequest(
                connection.0,
                verb.as_ptr(),
                path.as_ptr(),
                null(),
                null(),
                null(),
                flags,
            )
        })?;
        let mut headers = "Accept-Encoding: identity\r\n".to_string();
        if let Some(range) = range {
            headers.push_str(&format!("Range: {range}\r\n"));
        }
        if let Some(accept) = accept {
            headers.push_str(&format!("Accept: {accept}\r\n"));
        }
        let headers = wide(&headers);
        check(unsafe {
            WinHttpSendRequest(
                request.0,
                headers.as_ptr(),
                (headers.len() - 1) as u32,
                null(),
                0,
                0,
                0,
            )
        })?;
        check(unsafe { WinHttpReceiveResponse(request.0, null_mut()) })?;
        let mut status = 0u32;
        let mut size = size_of::<u32>() as u32;
        check(unsafe {
            WinHttpQueryHeaders(
                request.0,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                null(),
                (&mut status as *mut u32).cast(),
                &mut size,
                null_mut(),
            )
        })?;
        let content_range = if status == 206 {
            // A Content-Range of u64 byte offsets fits in this fixed buffer.
            let mut value = [0u16; 128];
            let mut size = size_of_val(&value) as u32;
            check(unsafe {
                WinHttpQueryHeaders(
                    request.0,
                    WINHTTP_QUERY_CONTENT_RANGE,
                    null(),
                    value.as_mut_ptr().cast(),
                    &mut size,
                    null_mut(),
                )
            })?;
            Some(String::from_utf16_lossy(
                &value[..value
                    .iter()
                    .position(|unit| *unit == 0)
                    .unwrap_or(value.len())],
            ))
        } else {
            None
        };
        Ok(Response {
            status: status as u16,
            content_range,
            body: Box::new(Body {
                request,
                _connection: connection,
                _session: session,
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::{TcpListener, TcpStream};
    use std::thread;

    fn read_request(stream: &mut TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            assert_eq!(stream.read(&mut byte).unwrap(), 1);
            bytes.push(byte[0]);
        }
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn follows_redirects_with_range_and_query_preserved() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let location = format!("{origin}/asset?token=test");
        let server = thread::spawn(move || {
            let (mut first, _) = listener.accept().unwrap();
            let first_request = read_request(&mut first);
            write!(first, "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            drop(first);
            let (mut second, _) = listener.accept().unwrap();
            let second_request = read_request(&mut second);
            second.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 3-5/6\r\nContent-Length: 3\r\nConnection: close\r\n\r\ndef").unwrap();
            (first_request, second_request)
        });
        let mut response = get(
            &format!("{origin}/start"),
            Some("bytes=3-"),
            None,
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(response.status, 206);
        assert_eq!(response.content_range.as_deref(), Some("bytes 3-5/6"));
        let mut body = String::new();
        response.body.read_to_string(&mut body).unwrap();
        assert_eq!(body, "def");
        let (first, second) = server.join().unwrap();
        assert!(first.to_lowercase().contains("range: bytes=3-"));
        assert!(second.starts_with("GET /asset?token=test HTTP/1.1"));
        assert!(second.to_lowercase().contains("range: bytes=3-"));
    }

    #[test]
    fn reads_release_json_and_keeps_not_found_status() {
        for (status, body) in [("200 OK", "更新"), ("404 Not Found", "not found")] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/release", listener.local_addr().unwrap());
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
                request
            });
            let mut response = get(
                &url,
                None,
                Some("application/vnd.github+json"),
                Duration::from_secs(5),
            )
            .unwrap();
            assert_eq!(
                response.status,
                if status.starts_with("200") { 200 } else { 404 }
            );
            let mut text = String::new();
            response.body.read_to_string(&mut text).unwrap();
            assert_eq!(text, body);
            let request = server.join().unwrap().to_lowercase();
            assert!(request.contains("accept: application/vnd.github+json"));
            assert!(request.contains("accept-encoding: identity"));
        }
    }

    #[test]
    fn rejects_non_http_or_missing_host_without_connecting() {
        for url in ["file:///test", "https:///"] {
            assert!(get(url, None, None, Duration::from_secs(1)).is_err());
        }
    }
}
