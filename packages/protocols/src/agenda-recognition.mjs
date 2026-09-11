import { findRussianDates } from './russian-date.mjs';

const ordinals=['первому','второму','третьему','четвертому','пятому','шестому','седьмому','восьмому','девятому','десятому',
  'одиннадцатому','двенадцатому','тринадцатому','четырнадцатому','пятнадцатому','шестнадцатому','семнадцатому','восемнадцатому','девятнадцатому','двадцатому'];
const fields={heard:'heardText',discussed:'discussedText',decision:'decisionText'};
const comparable=(value) => String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/gu,'е').replace(/\s+/gu,' ').trim();
export function questionHeading(text) {
  const source=String(text).replace(/^\d{1,3}[.)]\s*/u,'');
  const ordinal=source.match(/^по\s+([\p{L}\d-]+)\s+(?:вопросу|пункту)(?:\s+повестки(?:\s+дня)?)?\s*[:.,—–-]?\s*(.*)$/iu);
  if (ordinal) {
    const token=ordinal[1].toLowerCase().replace(/ё/gu,'е');
    const itemNo=/^\d{1,3}(?:-[а-я]+)?$/u.test(token) ? parseInt(token,10) : ordinals.indexOf(token)+1;
    if (itemNo > 0) return {itemNo,rest:ordinal[2]};
  }
  const number=source.match(/^(?:по\s+)?(?:вопрос(?:у)?|пункт(?:у)?)\s*№?\s*(\d{1,3})(?:\s+повестки(?:\s+дня)?)?\s*[.):—–-]?\s*(.*)$/iu);
  return number && Number(number[1]) > 0 ? {itemNo:Number(number[1]),rest:number[2]} : null;
}
function numbered(text) {
  const match=text.match(/^(\d{1,3})[.)]\s*(\S.*)$/u);
  return match && Number(match[1]) > 0 ? {itemNo:Number(match[1]),rest:match[2]} : null;
}
function signature(lines,index) {
  const text=lines[index].text;
  if (/^протокол\s+в[её]л[аи]?(?:\s|$)/iu.test(text) || /\|\s*протокол\s+в[её]л/iu.test(text)) return true;
  if (!/^(?:председатель|секретарь|начальник|заведующий)(?:\s|:|$)/iu.test(text)) return false;
  // A sentence assigning a duty to the head of department is not a signature.
  if (/(?:обязан|должен|поруч|подготов|обеспеч|представ|выполн|организ)/iu.test(text)) return false;
  const tail=lines.slice(index).filter((line) => line.text);
  return tail.length <= 8 && (/^(?:председатель|секретарь)(?:\s+заседания)?\s*[:—–-]/iu.test(text)
    || /^(?:начальник|заведующий)\s+(?:\d+\s+)?кафедр[ыой]*\s*(?:\||$)/iu.test(text));
}
function nextField(lines,index,match) {
  for (const line of lines.slice(index+1,index+8)) {
    if (!line.text) continue;
    if (numbered(line.text) || questionHeading(line.text)) return false;
    if (match(line.text,Object.keys(fields))) return true;
  }
  return false;
}
function addRange(ranges,line) {
  const previous=ranges.at(-1);
  if (previous && previous.lineEnd >= line-1) previous.lineEnd=Math.max(previous.lineEnd,line);
  else ranges.push({lineStart:line,lineEnd:line});
}
export function recognizeAgenda(lines,match) {
  const agendaIndex=lines.findIndex((line) => match(line.text,['agenda']));
  const scan=agendaIndex >= 0 ? lines.slice(agendaIndex+1) : lines;
  const items=new Map(); const diagnostics=[]; const unassigned=[];
  let current=null; let field='title'; let body=false;
  function select(number,line,title='') {
    if (!items.has(number)) items.set(number,{itemNo:number,title,heardText:'',discussedText:'',decisionText:'',ranges:[],bodyStarted:false});
    current=items.get(number); if (!current.title && title) current.title=title;
    addRange(current.ranges,line.no); return current;
  }
  function append(text,line) {
    if (!current) { if (body) unassigned.push({text:line.raw,line:line.no}); return; }
    if (text) current[field]=current[field] ? `${current[field]}${field === 'title' ? ' ' : '\n'}${text}` : text;
    addRange(current.ranges,line.no);
  }
  for (let index=0; index<scan.length; index+=1) {
    const line=scan[index]; if (!line.text) continue;
    if (body && signature(scan,index)) break;
    const explicit=questionHeading(line.text); const number=numbered(line.text);
    // Only a numbered hearing opens a question; numbered resolutions remain sub-decisions.
    const inline=number ? match(number.rest,['heard']) : null;
    if (explicit || inline) {
      const head=explicit || number; const item=select(head.itemNo,line);
      const label=inline || match(head.rest,Object.keys(fields));
      if (item.bodyStarted && (!label || label.kind === 'heard')) diagnostics.push({code:'duplicate_question',itemNo:head.itemNo,line:line.no,
        message:`Обсуждение вопроса ${head.itemNo} встречается повторно. Проверьте объединённый текст.`});
      item.bodyStarted=true;body=true;field=label ? fields[label.kind] : 'heardText';
      append(label ? label.value : head.rest,line);continue;
    }
    if (number && (!body || (nextField(scan,index,match) && (number.itemNo > Math.max(...items.keys(),0)
      || comparable(items.get(number.itemNo)?.title) === comparable(number.rest))))) {
      select(number.itemNo,line,number.rest);field='title';continue;
    }
    const label=match(line.text,Object.keys(fields));
    if (label) {
      if (!current) select(1,line,'Вопрос заседания');
      current.bodyStarted=true;body=true;field=fields[label.kind];append(label.value,line);continue;
    }
    append(line.text,line);
  }
  return {agendaItems:[...items.values()].map((item) => {
    const decisionText=item.decisionText.trim() || null;
    const issue=(code,message) => diagnostics.push({code,itemNo:item.itemNo,line:item.ranges[0]?.lineStart,message});
    if (!item.title) {item.title=`Вопрос ${item.itemNo}`;issue('question_title_missing',`Не найдено название вопроса ${item.itemNo}.`);}
    if (!item.bodyStarted) issue('question_body_missing',`Для вопроса ${item.itemNo} не найден ход обсуждения.`);
    else if (!decisionText) issue('question_decision_missing',`Для вопроса ${item.itemNo} не найдено решение.`);
    const dates=[...new Set(findRussianDates(decisionText || '').map((date) => date.value))];
    if (dates.length > 1) issue('question_due_ambiguous',`В решении вопроса ${item.itemNo} несколько дат. Уточните срок.`);
    return {itemNo:item.itemNo,title:item.title.trim(),heardText:item.heardText.trim() || null,discussedText:item.discussedText.trim() || null,
      decisionText,responsibleRaw:decisionText?.match(/ответственн(?:ый|ая|ые|ого|ым|ыми)?\s*[:–—-]\s*([^\n]+)/iu)?.[1]?.trim().replace(/[;,]+$/u,'') || null,
      dueDate:dates.length === 1 ? dates[0] : null,evidence:{lineStart:item.ranges[0]?.lineStart || null,lineEnd:item.ranges.at(-1)?.lineEnd || null,segments:item.ranges}};
  }),diagnostics,unassigned};
}
