# Discovery

Customer discovery for Phase 1. There is no client yet and no warm network to
draw on, so this is cold outreach.

Feature requests go in [`requests.md`](./requests.md). This file is the
narrower thing: **what to ask, and which answers change the code.**

## The one thing worth collecting

> Could you send me two or three rate confirmations with the rates and
> customer names blacked out?

Not a blocker — the extractor and the template engine get built against
synthetic and public samples. But synthetic fixtures are self-fulfilling: the
same person writes the document and the template that reads it. Real documents
are what stop the parser being designed around a generator's habits, and they
are the only way to learn how messy production PDFs actually are.

A broker who forwards two PDFs has given more than one who agrees to a call.

## The question that sizes the investment

**Do rate con layouts cluster by TMS vendor, or by shipper?**

This is a business signal, **not** a build gate — the template engine is the
same either way, and gets built against synthetic fixtures regardless. See
"what a document corpus actually calibrates" in CLAUDE.md.

What it predicts is whether Phase 2 self-serve is reachable: a "McLeod rate
con" template is reusable across every future client, where a per-shipper
template is bespoke work on every onboarding. In an interview it maps to:

- _What system generates your rate cons?_ — if the answer is a TMS name
  (McLeod, AscendTMS, Tai, Turvo, Revenova) rather than "a Word template",
  layouts are software-generated and templating generalises.
- _Do the rate cons you receive all look the same, or does every customer send
  something different?_
- _Roughly how many customers send you load tenders in a month?_ — tells you
  how concentrated the layout distribution is.

## Other answers that change the build

| Question                                                              | What it decides                                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Where do rate cons arrive — email attachment, load board portal, fax? | Whether Phase 3 inbox automation is the real product and the upload form is a stopgap     |
| Are they PDFs you can select text in, or scans/faxes?                 | Whether the OCR path is day-one or deferred. OCR needs a job queue, so this is a big fork |
| Who re-keys them — you, a dispatcher, an admin?                       | Who the user actually is, which changes the review screen                                 |
| How many loads a day, and how long does entering one take?            | Whether the time saved is worth paying for at all                                         |
| What do you do today — type into the TMS directly? Copy-paste?        | The baseline being competed against                                                       |
| What happens when something is entered wrong?                         | How much the confidence/flagging design matters                                           |

## How to ask

Ask about **what they do now**, not whether they would buy something. Stated
purchase intent is close to worthless; past behaviour and current workarounds
are not. "What did you do the last time a rate con came in?" beats "would this
be useful?"

Worth leading with the Houston logistics background — it is real, it is local,
and it is the difference between a vendor email and a peer email. No contacts
remain there, so it is context rather than a referral.

Keep the first email short, ask for one small concrete thing, and do not pitch
a product that does not exist yet.

## Sources for sample documents that need no client

- TMS vendors and brokers publish blank or sample rate confirmations as
  marketing and onboarding material.
- Carrier-facing "what to expect" pages often include a filled example.
- Industry forums and subreddits where carriers post rate cons to ask whether
  a rate is fair — frequently with the broker's letterhead intact.
- Synthetic documents generated to match a layout seen elsewhere. Good enough
  for regression tests; **not** good enough to answer the clustering question,
  which needs documents produced by real systems.

Keep every sample in `/fixtures/intake/`, anonymized, with a note on where it
came from and which system produced it.

## Log

Record outreach here — who, when, what came back. A list of non-responses is
also data about the channel.

| Date | Who | Channel | Asked for | Outcome |
| ---- | --- | ------- | --------- | ------- |

_No entries yet._

## Showing it to someone

The intake module is built and demoable: [`load-intake.md`](./load-intake.md)
walks the flow with screenshots and sample documents. A broker who will not
send documents may still sit through a five-minute demo of their own workflow
— and a demo is a better ask than a meeting, because it gives them something.
