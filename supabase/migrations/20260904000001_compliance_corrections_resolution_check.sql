alter table compliance_corrections
  add constraint compliance_corrections_resolution_coherent check (
    (resolution is null and corrected_paragraph_id is null)
    or (resolution = 'upheld' and corrected_paragraph_id is null)
    or (resolution = 'corrected' and corrected_paragraph_id is not null)
  );
