# Logical BK question mapping (Phase 3)

Inspected the actual two-page `public/forms/bk-skjema-blank.pdf`, its rendered pages, `bk/field-map-raw.json`, `lib/data/bk-skjema-field-geometry.json`, and `form-map.ts`. The PDF has 103 named fields and 109 widgets. Signature/date are printed areas without named controls. No geometry coordinates are changed.

The bundled six-sample report has **44 human controls**, collapsing into **12 required user questions** and **2 missing-measurement decisions**. There are also **3 receiver controls**, grouped separately and excluded from user tasks. Counts vary with missing metadata and recurring-waste answers. The full catalog has 24 potential user questions, including the optional generated-narrative review, conditional questions and missing extracted metadata, plus 2 measurement decisions and 1 receiver group.

| Logical question | Raw controls | Options / answer mapping |
| --- | --- | --- |
| delivery: What type of delivery is this? | group1, group6 | Single delivery; waste does not arise regularly → group1=Radio1, group6=Radio1; Regularly produced waste — first delivery → group1=Radio3, group6=Radio2; Regularly produced waste — subsequent delivery → group1=Radio4, group6=Radio2; Regularly produced waste — verification → group1=Radio5, group6=Radio2 |
| pickup: Where will the waste be collected? | TextField4 | Pickup location → TextField4 |
| marking: What is the producer's reference for this waste? | TextField5 | Producer reference → TextField5 |
| producer: Who produced the waste? | TextField6, TextField7 | Producer name → TextField6; Organisation number → TextField7 |
| address: What is the producer's address? | TextField8, TextField11, TextField14 | Address → TextField8; Postcode → TextField11; Town → TextField14 |
| contact: Who can answer questions about this waste? | TextField9, TextField12, TextField15 | Contact name → TextField9; Phone → TextField12; Email → TextField15 |
| transporter: Who is the transporter or contractor? | TextField10, TextField13, TextField16 | Transporter / contractor → TextField10; Phone → TextField13; Email → TextField16 |
| waste-number: What is the administrative waste number? | TextField23, TextField24, TextField25, TextField26 | Waste number (4 digits) → TextField23, TextField24, TextField25, TextField26 |
| industry: What is the industry code? | TextField27, TextField28, TextField29 | Industry code (3 digits) → TextField27, TextField28, TextField29 |
| municipality: What is the municipality code? | TextField30, TextField31, TextField32, TextField33, TextField34 | Municipality code (up to 5 digits) → TextField30, TextField31, TextField32, TextField33, TextField34 |
| toc: Total organic carbon (TOC) | TextField35 | A missing laboratory measurement cannot safely be guessed. Obtain analytical evidence before relying on it. |
| loss-on-ignition: Loss on ignition | TextField36 | A missing laboratory measurement cannot safely be guessed. Obtain analytical evidence before relying on it. |
| origin: How did the waste arise? | Checkbox11, Checkbox12, Checkbox13, Checkbox14, Checkbox15, Checkbox16, Checkbox17, Checkbox18 | Excavation / dredging → Checkbox11; Construction (new building) → Checkbox12; Production / industry → Checkbox13; Household / cabin → Checkbox14; Trade / office → Checkbox15; Sorting / waste facility → Checkbox16; Incineration plant → Checkbox17; Other → Checkbox18 |
| material: What type of waste is this? | Checkbox19, Checkbox20, Checkbox21, Checkbox22, Checkbox23, Checkbox24, Checkbox25, Checkbox26, Checkbox39, Checkbox40 | Contaminated soil / sediment → Checkbox19; Excavated material containing waste → Checkbox20; Street sweepings / grit → Checkbox21; Sand-trap material → Checkbox22; Concrete / brick → Checkbox23; Ash / slag → Checkbox24; Sewage sludge → Checkbox25; Screenings → Checkbox26; Mixed → Checkbox39; Other → Checkbox40 |
| physical: What best describes the physical form? | Checkbox27, Checkbox28, Checkbox29, Checkbox30, Checkbox31, Checkbox32 | Powder → Checkbox27; Liquid → Checkbox28; Large object (monolithic) → Checkbox29; Heterogeneous → Checkbox30; Homogeneous → Checkbox31; Other → Checkbox32 |
| pretreatment: Has the waste been pretreated? | Checkbox33, Checkbox34, Checkbox35, Checkbox36, Checkbox37, Checkbox38 | Sorting plant → Checkbox33; Biological treatment → Checkbox34; Incineration → Checkbox35; Grinding / shredding → Checkbox36; None → Checkbox37; Other pretreatment → Checkbox38 |
| colour: What colour is the waste? | TextField39 | Colour / description → TextField39 |
| smell: How does the waste smell? | TextField40 | Smell / description → TextField40 |
| description: Review the generated waste description | TextField38 | Waste description and evidence summary → TextField38 |
| fraction-0: Organic fraction in recurring waste (only recurring) | TextField42, TextField46 | Measured content (weight %) → TextField42; Normal variation (from–to %) → TextField46 |
| fraction-1: Inorganic fraction in recurring waste (only recurring) | TextField43, TextField47 | Measured content (weight %) → TextField43; Normal variation (from–to %) → TextField47 |
| fraction-2: Plastic fraction in recurring waste (only recurring) | TextField44, TextField48 | Measured content (weight %) → TextField44; Normal variation (from–to %) → TextField48 |
| fraction-3: Other fraction in recurring waste (only recurring) | TextField45, TextField49 | Measured content (weight %) → TextField45; Normal variation (from–to %) → TextField49 |
| verification-dates: When is recurring waste verified? (only recurring) | TextField50, TextField51 | Verification date → TextField50; Next verification date → TextField51 |
| verification-parameters: Which parameters are verified? (only recurring) | TextField52 | Verification parameters → TextField52 |
| recurring-documentation: What documentation supports recurring waste? (only recurring) | TextField53 | Supporting documentation → TextField53 |
| receiver: Receiver completes this | TextField1, TextField2, TextField3 | Customer number, the receiver's project reference and landfill remarks belong to the receiving facility. |

Choice answers set their selected control(s) and clear every alternative in the group. Delivery maps both group1 and group6, preventing a commercial default from looking supported. Numeric administrative codes split into the real digit widgets. “Other” explanations append to the existing waste description without replacing classification text. Recurring composition pairs measured/variation columns correctly (42–45 and 46–49), followed by dates 50–51, parameters 52 and supporting documentation 53.

TOC/loss-on-ignition gaps are not requests to invent a measurement. They remain cannot-determine decisions until new analytical evidence is provided. Receiver customer/project numbers are not the application’s own project identity and are not auto-filled. The current production model has no producer registration/address/contact profile; no organisation number or producer identity is invented from the portal customer name.
