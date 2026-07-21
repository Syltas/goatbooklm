-- Audio Overview (docs/specs/studio-audio.md): studio_artifacts.format trägt
-- jetzt auch die 4 Audio-Formate; Audio verlangt — wie Reports — ein Format.

alter table public.studio_artifacts
  drop constraint studio_artifacts_format_check;
alter table public.studio_artifacts
  add constraint studio_artifacts_format_check check (format in (
    'briefing_doc', 'study_guide', 'blog_post',
    'deep_dive', 'brief', 'critique', 'debate'
  ));

alter table public.studio_artifacts
  drop constraint studio_artifacts_report_requires_format;
alter table public.studio_artifacts
  add constraint studio_artifacts_requires_format
  check (type not in ('report', 'audio') or format is not null);

-- Kanonische content-Shape-Doku (ersetzt den veralteten Datei-Kommentar der
-- Ursprungsmigration, der für audio noch eine flache Shape nannte).
comment on column public.studio_artifacts.content is
  'Typ-abhängig. report: {markdown, truncated?}. flashcards: {title-los; cards:[{front,back}]}. quiz: {questions:[...]}. audio (Phasen-Lifecycle): {params:{language,length,focus}, phase: script|tts|done, script?:{title,turns:[{speaker,text}]}, tts?:{done,total}, storage_path?} — storage_path lebt NUR hier, es gibt keine Spalte dafür.';
