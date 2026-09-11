import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractDepartmentProtocol, looksLikeDepartmentProtocol } from '../packages/protocols/src/extractor.mjs';
const sample=await readFile(new URL('./fixtures/protocol-separate-agenda.txt',import.meta.url),'utf8');

test('отдельная повестка: три вопроса, все подпункты решений, подписи за границей решения',()=>{
  const result=extractDepartmentProtocol(sample);
  assert.equal(looksLikeDepartmentProtocol(sample),true);assert.equal(result.protocolNumber,'25');
  assert.deepEqual(result.agendaItems.map((item)=>item.itemNo),[1,2,3]);
  assert.equal(result.attendees,'7 чел.');assert.match(result.chairperson,/Примеров/);assert.match(result.secretary,/Образцова/);
  assert.match(result.agendaItems[0].decisionText,/1\) Содержание/);assert.match(result.agendaItems[0].decisionText,/2\) Тематику/);
  assert.match(result.agendaItems[1].decisionText,/1\. Индивидуальные/);
  assert.doesNotMatch(result.agendaItems[2].decisionText,/Начальник|Протокол вел|Образцова/);
  assert.deepEqual(result.diagnostics,[]);
  assert.ok(result.agendaItems[0].evidence.segments.length>1);
  for(const range of result.agendaItems[0].evidence.segments) assert.doesNotMatch(sample.split('\n').slice(range.lineStart-1,range.lineEnd).join('\n'),/По второму/);
});
test('дата-заполнитель не заменяется датой в повестке или решении',()=>{
  const result=extractDepartmentProtocol(sample.replace('Рекомендовать статью','До 15 сентября 2026 года рекомендовать статью'));
  assert.equal(result.meetingDate,null);assert.equal(result.meetingDateIssue,'invalid');assert.match(result.meetingDateRaw,/«00»/);
  assert.ok(result.confidence<.75);assert.equal(extractDepartmentProtocol(sample.replace('«00»','«05»')).meetingDate,'2026-07-05');
  assert.equal(extractDepartmentProtocol(sample.replace('Сотрудников','Дата согласования: 06.07.2026\nСотрудников')).meetingDate,null);
  assert.equal(extractDepartmentProtocol(sample.replace('«00»','«05»').replace('Сотрудников','Дата: 06.07.2026\nСотрудников')).meetingDateIssue,'ambiguous');
});
test('структурные метки допускают регистр, пробелы, одну опечатку и омоглифы',()=>{
  for(const marker of ['РЕШИЛИ','Постановили','Решено','Постановление','Решенне','Решенеи','РЕШЕHИЕ','Р Е Ш Е Н И Е']){
    const result=extractDepartmentProtocol(sample.replaceAll('Решение',marker).replaceAll(' ','\u00a0'));
    assert.equal(result.agendaItems.length,3,marker);assert.match(result.agendaItems[2].decisionText || '',/Рекомендовать/,marker);
  }
});
test('числовые ссылки на вопросы и пользовательские обозначения',()=>{
  const text=sample.replace('По первому вопросу','По вопросу № 1').replace('По второму вопросу','По 2-му вопросу').replace('По третьему вопросу','По 3 вопросу').replaceAll('Решение:','Итоговое заключение:');
  const result=extractDepartmentProtocol(text,{aliases:{decision:['Итоговое заключение']}});
  assert.equal(result.agendaItems.length,3);assert.match(result.agendaItems[2].decisionText,/Рекомендовать/);
  assert.doesNotMatch(result.agendaItems[2].heardText,/Итоговое заключение/);
});
test('неизвестное обозначение не становится молчаливым успехом; несколько сроков требуют уточнения',()=>{
  const unknown=extractDepartmentProtocol(sample.replaceAll('Решение:','Заключили:'));
  assert.equal(unknown.diagnostics.filter((item)=>item.code==='question_decision_missing').length,3);
  const multiple=extractDepartmentProtocol(sample.replace('Рекомендовать статью','До 15.09.2026 представить проект, до 20.09.2026 рекомендовать статью'));
  assert.equal(multiple.agendaItems[2].dueDate,null);assert.ok(multiple.diagnostics.some((item)=>item.code==='question_due_ambiguous'));
});
test('план и деловое предложение не превращаются в протокол или подпись',()=>{
  assert.equal(looksLikeDepartmentProtocol('ПЛАН РАБОТЫ КАФЕДРЫ\nна 2026 год\n1. По первому вопросу\nПротокол\nСекретарь'),false);
  const text=sample.replace('Начальник кафедры | Протокол вел','Начальник кафедры должен обеспечить публикацию.\nНачальник кафедры | Протокол вел');
  assert.match(extractDepartmentProtocol(text).agendaItems[2].decisionText,/должен обеспечить/);
});
