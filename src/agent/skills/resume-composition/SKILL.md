---
name: resume-composition
description: Compile an evidence-grounded general/base resume from a confirmed CareerProfile through the CareerAdapt workflow boundary.
---

# Resume composition

Use `career.workflow.compose_resume` for a new general/base resume. Use the
canonical `career.workflow.tailor_resume` facade for any saved-job or external-
target Job Resume; do not stage a target resume through composition first.
Read the confirmed Profile and optional Job through the host, build the
Evidence Graph, propose a Resume Blueprint, show information needs and review
findings, then wait for explicit confirmation before `compose_resume` writes an
isolated ResumeRevision.

Keep all claims tied to confirmed fact IDs, source excerpts, provenance, and
ownership wording. Classify claims as supported, derived presentation, needs
confirmation, or unsupported; unsupported claims must stay out of the
preview. Aggregate explicit technical tools across assets without inferring
proficiency or converting adjacent technologies into direct experience.

Ask at most two optional high-value questions and allow direct generation.
Profile synchronization is a separate explicit user action. Hermes/MCP uses
the gateway and never writes `WorkspaceRepository` directly.
