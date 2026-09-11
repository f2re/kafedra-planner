import { findRussianDates } from './russian-date.mjs';
import { createMarkerMatcher, markerKey } from './recognition-markers.mjs';
import { recognizeAgenda, questionHeading } from './agenda-recognition.mjs';

function linesOf(text) {
  return String(text || '').replace(/\r\n?/gu,'\n').split('\n')
    .map((raw,index) => ({no:index+1,raw,text:raw.replace(/\s+/gu,' ').trim()}));
}
function header(lines,match) {
  const end=lines.findIndex((line) => match(line.text,['agenda','heard','discussed','decision']) || questionHeading(line.text) || /^\d{1,3}[.)]\s+\S/u.test(line.text));
  return lines.slice(0,Math.min(end < 0 ? lines.length : end,80));
}
function labeled(lines,kind,match) {
  for (let index=0;index<lines.length;index+=1) {
    const line=lines[index];const found=match(line.text,[kind]);if (!found) continue;
    const values=[];if (found.value) values.push(found.value);let end=line.no;
    for (const next of lines.slice(index+1)) {
      if (!next.text) continue;
      if (match(next.text) || /^(?:сотрудников|кворум|дата|от\s+\d|протокол)/iu.test(next.text)) break;
      if (values.length && kind !== 'attendees') break;
      values.push(next.text);end=next.no;if (kind !== 'attendees') break;
    }
    if (values.length) return {value:values.join('\n'),evidence:{lineStart:line.no,lineEnd:end,raw:line.raw}};
  }
  return null;
}
function numberOf(lines) {
  for (const line of lines) {
    const key=markerKey(line.text);
    if (!/пр\S*токол|п\s*р\s*о\s*т\s*о\s*к\s*о\s*л/u.test(key) && !/^№/u.test(key)) continue;
    const match=line.text.match(/(?:№|\bNo\.?|\bN(?:[oо°º.]|(?=\s*\d))?)\s*([\p{L}\d][\p{L}\d./-]*)/iu);
    if (match) return match[1];
  }
  return null;
}
function dateOf(lines) {
  const candidates=[];const raw=[];let invalid=false;
  for (const line of lines) {
    const normalized=line.text.replace(/[«»„“”"']/gu,'');
    const resembles=/\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}|\d{1,2}\s+[а-яё]+\s+(?:19|20)\d{2}/iu.test(normalized);
    const dates=findRussianDates(normalized);
    if (resembles) {raw.push(line.raw);if (!dates.length) invalid=true;}
    for (const date of dates) candidates.push({...date,line:line.no,source:line.raw});
  }
  const unique=[...new Set(candidates.map((date) => date.value))];
  return {value:!invalid && unique.length === 1 ? unique[0] : null,raw:raw.join('\n') || null,candidates,
    reason:invalid ? 'invalid' : unique.length > 1 ? 'ambiguous' : null};
}
export function looksLikeDepartmentProtocol(text) {
  const lines=linesOf(text).filter((line) => line.text);
  if (/^(?:план|отч[её]т|распоряжение)(?:\s|$)/iu.test(lines[0]?.text || '')) return false;
  const heading=lines.slice(0,12).map((line) => markerKey(line.text)).join('\n');
  if (!/(^|\n)\s*(?:протокол|протокл|протоко[лп]|п\s+р\s+о\s+т\s+о\s+к\s+о\s+л)(?:\s|№|$)/iu.test(heading)) return false;
  const match=createMarkerMatcher();
  return lines.slice(0,80).some((line) => match(line.text) || questionHeading(line.text)) || /заседани[ея].*кафедр/u.test(heading);
}
export function extractDepartmentProtocol(text,options={}) {
  const lines=linesOf(text);const match=createMarkerMatcher(options.aliases);const head=header(lines,match);
  const date=dateOf(head);const metadata=Object.fromEntries(['chairperson','secretary','attendees'].map((kind) => [kind,labeled(head,kind,match)]));
  const agenda=recognizeAgenda(lines,match);
  const result={protocolNumber:numberOf(head),meetingDate:date.value,meetingDateRaw:date.raw,meetingDateIssue:date.reason,
    title:'Заседание кафедры',chairperson:metadata.chairperson?.value || null,secretary:metadata.secretary?.value || null,attendees:metadata.attendees?.value || null,
    agendaItems:agenda.agendaItems,diagnostics:agenda.diagnostics,unassigned:agenda.unassigned,
    fieldEvidence:{...Object.fromEntries(Object.entries(metadata).filter(([,value]) => value).map(([kind,value]) => [kind,value.evidence])),meetingDate:date.candidates},
    evidence:{lineStart:1,lineEnd:lines.length}};
  let confidence=.2+(result.protocolNumber ? .2 : 0)+(result.meetingDate ? .25 : 0)+(result.agendaItems.length ? .2 : 0)
    +(result.agendaItems.some((item) => item.decisionText) ? .1 : 0)+(result.chairperson || result.secretary ? .05 : 0);
  if (date.reason || agenda.diagnostics.length) confidence=Math.min(confidence,.69);
  return {...result,confidence:Math.min(1,Number(confidence.toFixed(2)))};
}
