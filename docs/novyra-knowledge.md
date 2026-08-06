# NOVYRA knowledge integration

The integration adds NOVYRA as an optional, verified news source for the existing AI pipeline. It is used by Playground, drafts and automatic replies because all three already call `retrieveKnowledge`.

It is disabled unless all `NOVYRA_*` credentials are configured. Failure or timeout returns an empty external result and leaves the webhook and local knowledge path operational.

Attribution is explicit: `citation_source` is visible evidence for the model; `discovery_source` is retained only as provenance and must not be presented as the origin of a fact.
