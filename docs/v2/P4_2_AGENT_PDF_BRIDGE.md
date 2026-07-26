# P4.2 Agent PDF import bridge

The Agent must not parse PDF bytes itself.

Production boundary:

1. Existing PDF extraction/OCR pipeline produces ordered page text and source evidence.
2. `adaptExtractedPdfForAgent` normalizes that result into an Agent import source.
3. `parse_resume_file` parses the provided text.
4. Existing import draft services preserve evidence and produce a `resume_import_review` artifact.
5. The user reviews and confirms before any profile or resume write.

Remaining integration work:

- expose the existing PDF import session/page-text result to `AgentWorkspace` after extraction completes;
- pass those pages through `adaptExtractedPdfForAgent`;
- extend `parse_resume_file` input to accept the adapter evidence alongside text;
- map adapter evidence into the existing `ImportedResumeDraft` provenance records;
- add a browser E2E covering upload → extraction/OCR → review artifact → confirmed import.

No duplicate PDF parser or OCR dependency is introduced by P4.2a.1.

## Runtime progress and watchdog contract

The Agent watchdog measures inactivity from `lastProgressAt`, not total task
duration from `startedAt`. Model deltas, tool status, OCR page progress, or
other heartbeat events must refresh `lastProgressAt`.

Long-running extraction or local OCR may legitimately take more than 30
seconds. It is not stalled while progress heartbeats continue. The 30-second
warning applies only when no progress event has been observed for that period;
it never authorizes an automatic retry of a write operation.
