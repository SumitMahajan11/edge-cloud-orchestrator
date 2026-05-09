use opentelemetry::{global, Context, KeyValue};
use opentelemetry::trace::{TraceContextExt, Tracer, TraceId, SpanId};
use opentelemetry_sdk::{propagation::TraceContextPropagator, runtime, trace as sdktrace, Resource};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use std::env;

pub fn init_telemetry(service_name: &str) {
    global::set_text_map_propagator(TraceContextPropagator::new());

    let otlp_endpoint = env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:4317".to_string());

    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint(otlp_endpoint),
        )
        .with_trace_config(
            sdktrace::config().with_resource(Resource::new(vec![KeyValue::new(
                "service.name",
                service_name.to_string(),
            )])),
        )
        .install_batch(runtime::Tokio)
        .expect("Failed to initialize OTLP tracer");

    let telemetry = tracing_opentelemetry::layer().with_tracer(tracer);
    
    let filter = tracing_subscriber::EnvFilter::from_default_env()
        .add_directive(tracing::Level::INFO.into());

    tracing_subscriber::registry()
        .with(filter)
        .with(telemetry)
        .with(tracing_subscriber::fmt::layer())
        .init();
}

/**
 * Creates an OpenTelemetry context from trace_id and span_id strings.
 * Used for propagating context from the control plane.
 */
pub fn get_parent_context(trace_id: Option<String>, span_id: Option<String>) -> Context {
    if let (Some(tid), Some(sid)) = (trace_id, span_id) {
        if let (Ok(t_id), Ok(s_id)) = (TraceId::from_hex(&tid), SpanId::from_hex(&sid)) {
            let span_context = opentelemetry::trace::SpanContext::new(
                t_id,
                s_id,
                opentelemetry::trace::TraceFlags::SAMPLED,
                false,
                opentelemetry::trace::TraceState::default(),
            );
            return Context::current().with_remote_span_context(span_context);
        }
    }
    Context::current()
}
