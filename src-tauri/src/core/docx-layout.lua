-- Resolve Chinese region aliases to the translation resources bundled by Pandoc.
function Meta(meta)
  if meta.lang then
    local aliases = {
      ['zh'] = 'zh-Hans', ['zh-cn'] = 'zh-Hans', ['zh-sg'] = 'zh-Hans',
      ['zh-tw'] = 'zh-Hant', ['zh-hk'] = 'zh-Hant', ['zh-mo'] = 'zh-Hant'
    }
    local lang = pandoc.utils.stringify(meta.lang):lower():gsub('_', '-')
    if aliases[lang] then meta.lang = pandoc.MetaString(aliases[lang]) end
  end
  return meta
end

-- The native DOCX pass removes these markers and binds the enclosed paragraphs.
function Div(div)
  if div.classes:includes('signature') then
    local table
    for _, block in ipairs(div.content) do if block.t == 'Table' then table = block end end
    if not table or #table.colspecs ~= 3 or #div.content ~= 1 then return nil end
    local rows, width = {}, 0
    for _, body in ipairs(table.bodies) do
      for _, row in ipairs(body.body) do
        rows[#rows + 1] = row
        local label = pandoc.utils.stringify(row.cells[1].contents)
        local units = 0
        for _, code in utf8.codes(label) do units = units + (code >= 0x2e80 and 1 or 0.55) end
        width = math.max(width, math.ceil((units + 1) * 100))
      end
    end
    local output = pandoc.List()
    local align = div.attributes.align or 'auto'
    if not ({left=true,center=true,right=true,auto=true})[align] then align = 'auto' end
    local function styled(content, name)
      return pandoc.Span(content, pandoc.Attr('', {}, {['custom-style']=name}))
    end
    local tab = pandoc.RawInline('openxml', '<w:r><w:tab/></w:r>')
    for index, row in ipairs(rows) do
      local values = {}
      for c = 1, 3 do
        local cell = row.cells[c]
        local inlines = pandoc.List()
        if cell then
          for _, block in ipairs(cell.contents) do
            if block.content then
              if #inlines > 0 then inlines:insert(pandoc.Space()) end
              inlines:extend(block.content)
            end
          end
        end
        values[c] = inlines
      end
      local content = pandoc.List { styled(values[1], 'MDKingSignatureLabel') }
      local label = pandoc.utils.stringify(values[1])
      if label:sub(-3) ~= '：' and label:sub(-1) ~= ':' then content:insert(pandoc.Str('：')) end
      content:insert(tab)
      local value = pandoc.utils.stringify(values[2])
      local blank = value:match('^____+$') ~= nil
      content:insert(styled(blank and {pandoc.Str('_')} or values[2], blank and 'MDKingSignatureLine' or 'MDKingSignatureValue'))
      content:insert(tab)
      content:insert(styled(values[3], 'MDKingSignatureRemark'))
      local name = 'MDKingSignature' .. align .. 'W' .. width .. (index == 1 and 'F' or '') .. (index == #rows and 'L' or '')
      output:insert(pandoc.Div({pandoc.Para(content)}, pandoc.Attr('', {}, {['custom-style']=name})))
    end
    return output
  end
  local kind
  if div.classes:includes('keep-together') then
    kind = div.classes:includes('with-previous') and 'KEEP_PREVIOUS' or 'KEEP'
  elseif div.classes:includes('landscape') then kind = 'LANDSCAPE' end
  if kind then
    local blocks = pandoc.List {
      pandoc.RawBlock('openxml', '<w:p><w:r><w:t>MDKING_LAYOUT_' .. kind .. '_START</w:t></w:r></w:p>')
    }
    blocks:extend(div.content)
    blocks:insert(pandoc.RawBlock('openxml', '<w:p><w:r><w:t>MDKING_LAYOUT_' .. kind .. '_END</w:t></w:r></w:p>'))
    return blocks
  end
  if ({left=true,center=true,right=true})[div.attributes.align] then
    div.attributes['custom-style'] = 'MDKingAlign' .. div.attributes.align
    return div
  end
end

local function apply_span(span, inherited_color, inherited_underline)
  local color = span.attributes.color
  if not (color and color:match('^#%x%x%x%x%x%x$')) then color = inherited_color end
  local underline = span.classes:includes('underline') or inherited_underline
  if color or underline then
    span.attributes['custom-style'] = 'MDKingFmt' .. (color and color:sub(2):upper() or 'inherit') .. (underline and 'U' or '')
    span.content = span.content:walk {
      Span = function(inner) return apply_span(inner, color, underline) end,
      Link = function(link)
        local attributes = { color = color or '#0563C1' }
        local inner = pandoc.Span(link.content, pandoc.Attr('', {'underline'}, attributes))
        link.content = pandoc.List { apply_span(inner, color, true) }
        return link
      end
    }
  end
  return span
end
function Span(span) return apply_span(span) end

function Inlines(content)
  local stack = { pandoc.List() }
  for _, item in ipairs(content) do
    local tag = item.t == 'RawInline' and item.format == 'html' and item.text:lower():gsub('%s+', '') or ''
    if tag == '<u>' then
      stack[#stack + 1] = pandoc.List()
    elseif tag == '</u>' and #stack > 1 then
      local inner = table.remove(stack)
      stack[#stack]:insert(pandoc.Underline(inner))
    else stack[#stack]:insert(item) end
  end
  while #stack > 1 do
    local inner = table.remove(stack)
    stack[#stack]:insert(pandoc.RawInline('html', '<u>'))
    stack[#stack]:extend(inner)
  end
  return stack[1]
end

function Para(para)
  if #para.content == 1 and para.content[1].t == 'Span' then
    local align = para.content[1].attributes.align
    if ({left=true,center=true,right=true})[align] then
      return pandoc.Div({para}, pandoc.Attr('', {}, {['custom-style']='MDKingAlign' .. align}))
    end
  end
end
