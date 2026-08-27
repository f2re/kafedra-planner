export function enrichMeetingDocumentTemplateMetadata(database, documents = []) {
  return (Array.isArray(documents) ? documents : []).map((document) => {
    const catalog = database.get(`
      SELECT display_name, version_no, readiness, lifecycle_status, profile_version_id
      FROM meeting_template_catalog
      WHERE document_version_id = ? AND document_kind = ?
      ORDER BY lifecycle_status = 'active' DESC, version_no DESC
      LIMIT 1
    `, document.template_version_id, document.document_kind);
    if (!catalog) return document;
    return {
      ...document,
      template_display_name: catalog.display_name,
      template_version_no: catalog.version_no,
      template_readiness: catalog.readiness,
      template_lifecycle_status: catalog.lifecycle_status,
      template_profile_version_id: catalog.profile_version_id
    };
  });
}
