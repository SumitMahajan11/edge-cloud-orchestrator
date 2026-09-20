import { trace } from '@opentelemetry/api';
import { getActiveTraceContext } from '../otel-log-context';

describe('API logger OpenTelemetry context', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds trace_id and span_id from the active span', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      spanContext: () => ({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
      }),
    } as any);

    expect(getActiveTraceContext()).toEqual({
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      span_id: '00f067aa0ba902b7',
    });
  });

  it('does not add correlation fields when no span is active', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);

    expect(getActiveTraceContext()).toEqual({});
  });
});
