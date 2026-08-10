# Third-party notices

P4.4d uses original CareerAdapt AI code and prompts. The following open-source
projects were reviewed for workflow or runtime design. No source code, prompt
text, report template, or personal data was copied into the product.

## NousResearch/hermes-agent

- Repository: <https://github.com/NousResearch/hermes-agent>
- License: MIT.
- Use in this project: architectural study only. The browser-safe Hermes
  bridge, server proxy, fallback router, and CareerToolGateway integration
  are original CareerAdapt AI implementation. Hermes skill-authoring guidance
  was reviewed from the official developer guide; the five skill files remain
  CareerAdapt AI-authored.

## MadsLorentzen/ai-job-search

- Repository: <https://github.com/MadsLorentzen/ai-job-search>
- License: MIT.
- Use in this project: workflow patterns adapted into
  `skills/career/`—bounded setup, fit-before-tailoring, reviewer/revise
  sequencing, final artifact verification, and P4.5b's proposal-before-write
  resume composition flow. See
  `skills/career/ATTRIBUTIONS.md` for reviewed paths and changes.

## yanliudesign/offer-toolkit-skill

- Repository: <https://github.com/yanliudesign/offer-toolkit-skill>
- License: MIT.
- Use in this project: evidence-first, one-question, decode-before-match, and
  structure-before-render patterns adapted into `skills/career/`.

## yanliudesign/job-description-skill

- Repository: <https://github.com/yanliudesign/job-description-skill>
- License: MIT.
- Use in this project: requirement decoding, must/nice separation, explicit
  gap reporting, and fit-before-tailoring order. No upstream HTML assets or
  prompts were imported.
