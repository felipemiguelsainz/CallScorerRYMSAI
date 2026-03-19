import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { evaluacionesApi, EvaluacionesFilters } from '../services/api.service';

export function useEvaluaciones(filters?: EvaluacionesFilters) {
  return useQuery({
    queryKey: ['evaluaciones', filters],
    queryFn: () => evaluacionesApi.list(filters).then((r) => r.data),
  });
}

export function useEvaluacion(id: string) {
  return useQuery({
    queryKey: ['evaluacion', id],
    queryFn: () => evaluacionesApi.get(id).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCreateEvaluacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: evaluacionesApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evaluaciones'] }),
  });
}

export function useUpdateEvaluacion(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof evaluacionesApi.update>[1]) =>
      evaluacionesApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evaluacion', id] });
      qc.invalidateQueries({ queryKey: ['evaluaciones'] });
    },
  });
}

export function useUploadAudio(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => evaluacionesApi.uploadAudio(id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evaluacion', id] }),
  });
}

export function useScoreEvaluacion(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => evaluacionesApi.score(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evaluacion', id] }),
  });
}

export function useAnalyzeDebtor(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => evaluacionesApi.analyzeDebtor(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evaluacion', id] }),
  });
}

export function useCompleteEvaluacion(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => evaluacionesApi.complete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evaluacion', id] });
      qc.invalidateQueries({ queryKey: ['evaluaciones'] });
    },
  });
}
