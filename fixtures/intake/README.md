# Intake fixtures

Documents the extraction pipeline is tested against.

**No real customer data.** Every file here is either synthetic or a publicly
published sample. Record the provenance of anything added, because it decides
what the fixture is evidence of.

| File                             | Provenance                                                                                                       | What it tests                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `synthetic-rate-con.pdf`         | Generated locally from `synthetic-rate-con.txt` via macOS `cupsfilter`. Invented carriers, addresses, and rates. | The PDF text stage: fragment reassembly, coordinate flip, line ordering.                   |
| `synthetic-rate-con.txt`         | The source text the PDF was rendered from.                                                                       | Keeps the PDF reproducible and reviewable in a diff.                                       |
| `sample-rate-con-b.txt`          | Invented. Deliberately the **same form** as the file above, with different values.                               | Layout fingerprinting: two fillings of one form must cluster together.                     |
| `sample-tender-other-vendor.txt` | Invented. A different vendor's tender — different labels, in different places.                                   | That a different layout does **not** cluster, and where the generic label parser gives up. |

## Fake the identifiers too, not just the names

`synthetic-rate-con.txt` pairs the invented carrier "GULF COAST HAULING LLC"
with **MC-133655 / DOT-264184 — Schneider National's real numbers**, reused
from probing the live QCMobile API. A synthetic document carrying real
identifiers is not synthetic: in any database that has vetted that MC, the
fixture silently links to the real carrier, and the screen then shows a
carrier name the document never mentioned.

That is how the carrier name/number mismatch warning got found, so it earned
its keep once. The rule still stands — newer fixtures here use obviously
unassigned numbers (the `9990xx` range). Fixing the original means
regenerating the PDF and updating four test files.

## A synthetic fixture cannot tell you the parser works

Writing the document and the template that reads it means both sides agree by
construction. These fixtures prove the engine runs and keep it from
regressing. They say nothing about whether real rate cons are parseable, and
they will quietly shape the parser around habits a generator has and a real
producer does not — clean `Label: value` pairs, no tables, no rotated stamps,
no merged text runs.

Real documents are tracked in `docs/discovery.md`. When they arrive, add them
here anonymized, note which system produced them, and expect the first few to
break things.

## Looking at one

A walkthrough with screenshots is in [`docs/load-intake.md`](../../docs/load-intake.md).

```
npm run intake:inspect -- fixtures/intake/synthetic-rate-con.pdf
npm run intake:inspect -- --quiet fixtures/intake/*.txt
```

Reports what the text stage saw (pages, item positions, assembled lines and
columns, whether a page needs OCR), the layout fingerprint, and what the parser
extracted with its per-field confidence. Pass several files and it also prints
how the layouts cluster — which is the answer to "do these group by TMS vendor
or by shipper" in the only form real documents can give it.

A `.txt` or `.eml` file is read as pasted text, so an emailed tender belongs
here as plain text rather than being converted to a PDF first.
