# Status: not built yet, next session

> WARNING: this file is a running note, not a source of truth. Verify any claim against the code before building on it, and update this file as work lands. (It previously said OCR was being built; it is not — `tesseract.js` is not even a dependency. Only scan _detection_ exists, which is what the OCR entry below says.)

Deliberately not built yet
A Document repository — that table exists, but its access patterns belong to document generation. Load and Party repositories are built; intake was the real module they were waiting for
The PDF renderer and a DocumentStore implementation (both land with doc generation)
OCR. pageNeedsOcr detects a scan and the pipeline returns needs_ocr, which the screen explains. The path itself needs a job queue — see the constraints above
Per-layout templates. The generic label-proximity parser is the baseline; templates should be built where they measurably beat it on real documents, which needs real documents
Deleting a saved load. Editing is built (/loads/[id]/edit): any field, the route, and a facility's address, with every change recorded in details.edits. Deleting is not — a bad import gets corrected rather than removed. Status is still inferred at intake and not settable by hand, so a load that saved as draft for want of a rate stays a draft after the rate is filled in; a real lifecycle needs discovery, not invention
Storing a date with no time. A stop's window is a date and a time together (joinLocal needs both), so a document stating "Delivery 11/03" with no appointment window loses the date — on the intake path as much as the edit path. The edit trail stays silent about it rather than reporting a save that did not happen, which is honest but not a fix. Closing it means either a separate nullable date column on stop or carrying the precision in appointment_type; both are schema decisions, and both collide with the rule that a window never claims a precision the document did not state
One address, stored twice. The parser writes the whole address line into Party.addressLine1 and splits out city/region/postalCode, and StopRow prints all four. Correct the ZIP in the field labelled ZIP and the old one is still sitting in the address line beside it. Harmless while nothing could be edited; actively misleading now that it can be, because a reviewer who fixes it will believe they did
Per-stop timezones. A stop stores the facility's zone when the Party has one, and new parties get null — the document never states a zone and inferring one from the state would be the exact guess the time-window model exists to avoid. The screen says "local time at the dock". Setting a zone per facility is the fix, and it needs a facilities screen
Refreshing a carrier's name or address on re-vet. vetCarrier sets details when it creates a carrier and never updates it, because CarrierRepository has no update method. Stale rather than wrong — the raw payload on every check has the current values. Add the method when a screen needs it
Searching a carrier by name (the QCMobile /carriers/name/:name endpoint). Brokers vet by number; add this only if discovery says otherwise
Next session
Point the inspector at real documents. The code is no longer the constraint; the corpus is. npm run intake:inspect -- <file...> reports, per document, what the text stage saw, the layout fingerprint, what the parser extracted and which fields it flagged — and across several documents, how the layouts cluster. Three or four brokers' worth of rate cons turns every open question in this file into an answer:

How much of a real corpus is scans, which decides whether OCR is a rare path or the main one.
Whether layouts cluster by TMS vendor or by shipper — run the inspector over the lot and read the cluster report.
Where the generic parser actually fails, which is the only honest basis for writing a template.
Whether the confidence scale is calibrated: details.intake.corrections accumulates cases where the parser was confident and wrong.
Add each document to /fixtures/intake/ anonymized, with its provenance, and expect the first few to break things.

This runs in parallel with discovery rather than after it — see docs/discovery.md. There is no client yet and no former-colleague network to draw on, so sample rate cons come from cold outreach and public sources.

Then document generation, which is now unblocked: load intake has defined what a load record contains.

One known wart in the fixtures, worth fixing before the corpus grows: synthetic-rate-con.txt pairs the invented carrier "GULF COAST HAULING LLC" with MC-133655 / DOT-264184, which are Schneider National's real numbers — they were used to probe the live QCMobile API and then copied into the fixture. It contradicts "fixtures are synthetic carriers", and in a dev database that has vetted the real MC it makes the fixture load link to Schneider, which is confusing. (It is also what surfaced the name-mismatch warning, so it earned its keep once.) Changing it means regenerating the PDF and updating four test files.
