import JSZip from 'jszip'
import type { LearnPage } from './learn.js'
import type { WorkingSessionTopic } from '../../common/contracts/working-session.js'

const nsA = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const nsR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const nsP = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

// eslint-disable-next-line no-control-regex
const escapeXml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value

const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>'

const theme = `${xmlHeader}<a:theme xmlns:a="${nsA}" name="TLC Draft"><a:themeElements><a:clrScheme name="TLC"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="0078D4"/></a:accent1><a:accent2><a:srgbClr val="50E6FF"/></a:accent2><a:accent3><a:srgbClr val="107C10"/></a:accent3><a:accent4><a:srgbClr val="FFB900"/></a:accent4><a:accent5><a:srgbClr val="D83B01"/></a:accent5><a:accent6><a:srgbClr val="5C2D91"/></a:accent6><a:hlink><a:srgbClr val="0078D4"/></a:hlink><a:folHlink><a:srgbClr val="5C2D91"/></a:folHlink></a:clrScheme><a:fontScheme name="TLC"><a:majorFont><a:latin typeface="Segoe UI Semibold"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="TLC"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`

function textBox(id: number, name: string, x: number, y: number, cx: number, cy: number, paragraphs: string, anchor = 't'): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
}
const run = (text: string, size: number, bold = false, color = '1F2937') =>
  `<a:r><a:rPr lang="en-US" sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${escapeXml(text)}</a:t></a:r>`
const paragraph = (text: string, size: number, bold = false, color?: string) => `<a:p>${run(text, size, bold, color)}</a:p>`
const bullet = (text: string) => `<a:p><a:pPr marL="285750" indent="-285750"><a:spcBef><a:spcPts val="600"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/></a:pPr>${run(text, 2000)}</a:p>`

interface Slide { title: string; bullets: string[]; subtitle?: string }

function slideXml(slide: Slide, footer: string): string {
  const shapes = [
    textBox(2, 'Title', 609600, 365760, 10972800, 1005840, paragraph(clip(slide.title, 110), 3200, true, '0078D4'), 'ctr'),
    textBox(3, 'Body', 609600, 1554480, 10972800, 4572000, (slide.subtitle ? paragraph(clip(slide.subtitle, 200), 2200, false, '4B5563') : '') + slide.bullets.map((text) => bullet(clip(text, 220))).join('')),
    textBox(4, 'Footer', 609600, 6309360, 10972800, 365760, paragraph(footer, 1100, false, 'D83B01'), 'ctr')
  ]
  return `${xmlHeader}<p:sld xmlns:a="${nsA}" xmlns:r="${nsR}" xmlns:p="${nsP}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

function outlineFor(page: LearnPage): string[] {
  const headings = [...page.markdown.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => (match[1] ?? '').replace(/[#*`[\]]/g, '').trim()).filter((heading) => heading && !/^(next steps?|see also|related content|feedback)$/i.test(heading))
  if (headings.length >= 2) return headings.slice(0, 5)
  const sentences = page.markdown.replace(/^#.*$/gm, ' ').replace(/[#*`>|]/g, ' ').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((value) => value.trim()).filter((value) => value.length > 30)
  return sentences.slice(0, 3)
}

/** A plain outline deck built from Learn content. It is a labelled draft, not a finished presentation. */
export async function buildDraftOutlineDeck(topic: WorkingSessionTopic, pages: LearnPage[], generated: Date): Promise<Uint8Array> {
  const footer = 'DRAFT outline generated by TLC Assist from Microsoft Learn - review and edit before presenting'
  const date = generated.toISOString().slice(0, 10)
  const slides: Slide[] = [
    { title: topic.topic, subtitle: 'Working session - draft outline', bullets: [`Domain: ${topic.domain}`, `Key services: ${topic.azureServices.slice(0, 5).join(', ') || 'to be confirmed'}`, `Prepared ${date}`] },
    { title: 'Agenda', bullets: [...pages.slice(0, 8).map((page) => page.title), 'Proof-of-concept scope and next steps'] }
  ]
  for (const page of pages.slice(0, 8)) {
    const points = outlineFor(page)
    slides.push({ title: page.title, bullets: [...(points.length ? points : ['See the source article for details.']), `Source: ${page.url}`] })
  }
  slides.push({ title: 'Proof of concept and next steps', bullets: ['Confirm scope, success criteria and customer owners', 'Review the draft deployment template (iac/main.bicep) with the customer architect', 'Agree dates, environment access and the support model'] })

  const zip = new JSZip()
  const count = slides.length
  zip.file('[Content_Types].xml', `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`)
  zip.file('_rels/.rels', `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${nsR}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${nsR}/extended-properties" Target="docProps/app.xml"/></Relationships>`)
  zip.file('docProps/core.xml', `${xmlHeader}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(`DRAFT - ${topic.topic}`)}</dc:title><dc:creator>TLC Assist</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${generated.toISOString()}</dcterms:created></cp:coreProperties>`)
  zip.file('docProps/app.xml', `${xmlHeader}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>TLC Assist</Application><Slides>${count}</Slides></Properties>`)
  zip.file('ppt/presentation.xml', `${xmlHeader}<p:presentation xmlns:a="${nsA}" xmlns:r="${nsR}" xmlns:p="${nsP}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${nsR}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, index) => `<Relationship Id="rId${index + 2}" Type="${nsR}/slide" Target="slides/slide${index + 1}.xml"/>`).join('')}<Relationship Id="rId${count + 2}" Type="${nsR}/theme" Target="theme/theme1.xml"/></Relationships>`)
  zip.file('ppt/theme/theme1.xml', theme)
  zip.file('ppt/slideMasters/slideMaster1.xml', `${xmlHeader}<p:sldMaster xmlns:a="${nsA}" xmlns:r="${nsR}" xmlns:p="${nsP}"><p:cSld>${emptyTree}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`)
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${nsR}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${nsR}/theme" Target="../theme/theme1.xml"/></Relationships>`)
  zip.file('ppt/slideLayouts/slideLayout1.xml', `${xmlHeader}<p:sldLayout xmlns:a="${nsA}" xmlns:r="${nsR}" xmlns:p="${nsP}" type="blank" preserve="1"><p:cSld name="Blank">${emptyTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${nsR}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`)
  slides.forEach((slide, index) => {
    zip.file(`ppt/slides/slide${index + 1}.xml`, slideXml(slide, footer))
    zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`, `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${nsR}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`)
  })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
