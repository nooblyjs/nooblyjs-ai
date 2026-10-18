/**
 * Default Continuous Exploration templates seeded on first run if the templates directory
 * is empty. These match the three template chips the sidebar UI advertises.
 */

'use strict';

module.exports = [
  {
    id: 'microservice',
    name: 'Microservice',
    description: 'A new HTTP microservice with its own datastore and a small surface area.',
    systemPrompt: [
      'You are designing a new microservice. Optimise for clarity, single responsibility, and operability.',
      'Default to: HTTP/JSON over REST, OpenAPI for contracts, structured JSON logging, OpenTelemetry traces, health + readiness probes.',
      'Treat the datastore as private to the service; only expose it through the API. Avoid distributed transactions.'
    ].join(' '),
    documents: [
      {
        name: 'requirements.md',
        prompt: 'Restate the requirement in your own words. List explicit functional requirements, non-functional requirements, and out-of-scope items as bulleted lists.'
      },
      {
        name: 'architecture.md',
        prompt: 'Describe the service architecture: components, datastore choice, external dependencies, deployment topology. Include a small ASCII or mermaid block diagram.'
      },
      {
        name: 'api-spec.md',
        prompt: 'Draft the public HTTP API: list endpoints with method, path, request schema, response schema, and error cases. Use a short example payload per endpoint.'
      },
      {
        name: 'data-model.md',
        prompt: 'Specify the core entities and their fields, including types and constraints. Note indexes and any migration considerations.'
      },
      {
        name: 'operability.md',
        prompt: 'Cover observability (logs, metrics, traces), failure modes, runbook entries, SLOs, and rollout strategy.'
      }
    ]
  },
  {
    id: 'integration',
    name: 'Integration',
    description: 'Wiring two existing systems together — adapters, mappings, failure handling.',
    systemPrompt: [
      'You are designing an integration between two existing systems. Favor idempotent operations, observable retries, and explicit field mappings.',
      'Surface assumptions about each side; never silently coerce types.'
    ].join(' '),
    documents: [
      {
        name: 'requirements.md',
        prompt: 'Capture what triggers the integration, both endpoints involved, expected throughput, and SLAs.'
      },
      {
        name: 'mapping.md',
        prompt: 'Provide a field-by-field mapping table between source and target schemas, including transformations and default values.'
      },
      {
        name: 'failure-handling.md',
        prompt: 'List failure modes (network, schema drift, partial success). For each, define detection, retry policy, alerting, and human-recovery steps.'
      },
      {
        name: 'sequence.md',
        prompt: 'Describe the happy-path sequence and the most important error sequence as numbered steps or a mermaid sequenceDiagram.'
      }
    ]
  },
  {
    id: 'data-pipeline',
    name: 'Data Pipeline',
    description: 'A scheduled or event-driven pipeline that moves and transforms data.',
    systemPrompt: [
      'You are designing a data pipeline. Make stages idempotent, recoverable, and observable.',
      'Default to a clear stage boundary between ingest, transform, and load. State retention, late-data, and schema-evolution policies explicitly.'
    ].join(' '),
    documents: [
      {
        name: 'requirements.md',
        prompt: 'Describe the source(s), sink(s), volumes, latency targets, and freshness expectations.'
      },
      {
        name: 'pipeline-design.md',
        prompt: 'Lay out stages (ingest, transform, validate, load). For each stage, state inputs, outputs, idempotency, and failure semantics.'
      },
      {
        name: 'schema.md',
        prompt: 'Specify input schemas, intermediate schemas, and output schemas. Call out evolution rules and how breaking changes are handled.'
      },
      {
        name: 'scheduling-and-ops.md',
        prompt: 'Cover trigger (cron / event), backfill strategy, monitoring (lag, error rate, freshness), and on-call runbook entries.'
      }
    ]
  }
];
