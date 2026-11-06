## ADDED Requirements

### Requirement: Code-only ingestion profile and pinned corpus manifest
Every contest used for evaluation SHALL be ingested through a corpus manifest entry. Each entry SHALL declare:

- the data-repository commit;
- the contest directory;
- a non-empty include-roots profile;
- the scorer-only findings directory;
- the ingestion policy version;
- the expected snapshot ID and tree digest.

Evaluation ingestion SHALL refuse an entry without include roots. It SHALL read the data repository without writing to it, and SHALL store snapshots only inside the harness repository's ignored data area.

#### Scenario: Entry without include roots is refused
- **GIVEN** a corpus manifest entry whose include roots are missing or empty
- **WHEN** evaluation ingestion is requested for it
- **THEN** ingestion fails before any file is read and no snapshot is created

#### Scenario: Data repository stays untouched
- **GIVEN** a data repository checked out at the pinned commit with a clean working tree
- **WHEN** every manifest entry is ingested and verified
- **THEN** the data repository's working tree is still clean

### Requirement: Scorer-side contamination preflight
Before an evaluation batch, a scorer-side check SHALL search every file of each contest snapshot for the normalised title of every valid and invalid finding of that contest. Normalisation is lower-case, with non-alphanumeric runs collapsed and titles of at least 12 characters. The check SHALL fail the batch and name the leaking findings and files when any title occurs. Finding titles SHALL be used only by this check and SHALL never reach the runner, the tools, provider requests or trajectory events.

#### Scenario: Leaked finding title fails the batch
- **GIVEN** a snapshot containing a file whose text includes the title of a valid finding of the same contest
- **WHEN** the contamination preflight runs
- **THEN** it reports that finding and that file, and the batch does not start

#### Scenario: Code-only snapshots of the verification data are clean
- **GIVEN** the three contests of the verification data ingested with their manifest profiles
- **WHEN** the contamination preflight runs against each contest's findings
- **THEN** no finding title is found in any snapshot

### Requirement: Snapshot reproducibility check
A verification command SHALL re-ingest every corpus manifest entry from the pinned data commit and SHALL fail when a resulting snapshot ID or tree digest differs from the manifest.

#### Scenario: Re-ingestion reproduces the pinned snapshot
- **GIVEN** a corpus manifest produced from the pinned data commit
- **WHEN** the verification command re-ingests every entry
- **THEN** every snapshot ID and tree digest equals the manifest value and the command exits successfully
