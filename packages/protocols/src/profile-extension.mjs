const PROFILE_ALIASES = new Map([
  ['protocol_number', 'protocolNumber'],
  ['nomer_protokola', 'protocolNumber'],
  ['registracionnyi_nomer', 'protocolNumber'],
  ['meeting_date', 'meetingDate'],
  ['data_zasedaniya', 'meetingDate'],
  ['data_protokola', 'meetingDate'],
  ['chairperson', 'chairperson'],
  ['predsedatel', 'chairperson'],
  ['predsedatelstvoval', 'chairperson'],
  ['secretary', 'secretary'],
  ['sekretar', 'secretary'],
  ['attendees', 'attendees'],
  ['prisutstvuyuschie', 'attendees'],
  ['prisutstvovali', 'attendees']
]);

function normalizedKey(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^a-z0-9а-я]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function comparable(value) {
  return String(value ?? '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/\s+/gu, ' ')
    .trim();
}

function empty(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

export function canonicalProtocolProfileField(key) {
  return PROFILE_ALIASES.get(normalizedKey(key)) || null;
}

export function extendProtocolWithProfileApplications(baseResult, applications = []) {
  const result = {
    ...baseResult,
    profileApplications: [],
    profileFields: [],
    profileConflicts: []
  };

  for (const application of applications) {
    const template = application?.template || {};
    const extracted = application?.result || {};
    const summary = {
      templateId: template.id || null,
      templateCode: template.code || null,
      templateVersion: template.version ?? null,
      confidence: Number(extracted.confidence || 0),
      missing: Array.isArray(extracted.missing) ? extracted.missing : []
    };
    result.profileApplications.push(summary);

    for (const [key, value] of Object.entries(extracted.values || {})) {
      const canonicalField = canonicalProtocolProfileField(key);
      const evidence = extracted.evidence?.[key] || null;
      const field = {
        key,
        canonicalField,
        value,
        evidence,
        templateId: template.id || null,
        templateCode: template.code || null,
        templateVersion: template.version ?? null,
        confidence: Number(evidence?.valid === false ? 0.6 : extracted.confidence || 0)
      };
      result.profileFields.push(field);

      if (!canonicalField) continue;
      const current = result[canonicalField];
      if (empty(current)) {
        result[canonicalField] = value;
        continue;
      }
      if (comparable(current) !== comparable(value)) {
        result.profileConflicts.push({
          field: canonicalField,
          existing: current,
          incoming: value,
          evidence,
          templateId: template.id || null,
          templateCode: template.code || null
        });
      }
    }
  }

  return result;
}
