/// <reference types="vitest" />
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useEvaluacion, useUploadAudio } from './useEvaluation';

const getMock = vi.fn();
const uploadMock = vi.fn();

vi.mock('../services/api.service', () => ({
  evaluacionesApi: {
    get: (...args: unknown[]) => getMock(...args),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    uploadAudio: (...args: unknown[]) => uploadMock(...args),
    score: vi.fn(),
    analyzeDebtor: vi.fn(),
    complete: vi.fn(),
  },
}));

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useEvaluation hooks', () => {
  beforeEach(() => {
    getMock.mockReset();
    uploadMock.mockReset();
  });

  it('loads evaluation by id', async () => {
    getMock.mockResolvedValueOnce({ data: { id: 'eval-1' } });

    const { result } = renderHook(() => useEvaluacion('eval-1'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('eval-1');
  });

  it('passes onProgress callback to uploadAudio', async () => {
    uploadMock.mockResolvedValueOnce({ data: { ok: true } });
    const progressSpy = vi.fn();
    const file = new File(['audio'], 'sample.mp3', { type: 'audio/mpeg' });

    const { result } = renderHook(() => useUploadAudio('eval-2'), {
      wrapper: makeWrapper(),
    });

    result.current.mutate({ file, onProgress: progressSpy });

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(uploadMock).toHaveBeenCalledWith('eval-2', file, progressSpy);
  });
});
