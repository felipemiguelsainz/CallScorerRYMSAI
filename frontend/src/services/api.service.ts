import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001',
  withCredentials: true,
});

// Shared promise avoids sending multiple /refresh calls during concurrent 401 bursts.
let refreshPromise: Promise<unknown> | null = null;

type RetryableRequestConfig = {
  _retry?: boolean;
  url?: string;
};

// Handle 401 globally: try token refresh once, then redirect only when session is invalid.
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error.response?.status;
    const config = (error.config ?? {}) as RetryableRequestConfig;
    const requestUrl: string = config.url ?? '';
    const isAuthEndpoint = requestUrl.includes('/api/v1/auth/');
    const isAuthCheckEndpoint = requestUrl.includes('/api/v1/auth/me');

    if (status === 401 && !isAuthEndpoint && !config._retry) {
      config._retry = true;
      try {
        if (!refreshPromise) {
          refreshPromise = authApi.refresh();
        }
        await refreshPromise;
        return api.request(config);
      } catch {
        if (isAuthCheckEndpoint && window.location.pathname !== '/login') {
          window.location.assign('/login');
        }
      } finally {
        refreshPromise = null;
      }
    } else if (status === 401 && isAuthCheckEndpoint && window.location.pathname !== '/login') {
      window.location.assign('/login');
    }

    return Promise.reject(error);
  },
);

// ─── AUTH ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (usuario: string, password: string) =>
    api.post<{ user: User }>('/api/v1/auth/login', { usuario, password }),
  refresh: () => api.post<{ user: User }>('/api/v1/auth/refresh'),
  logout: () => api.post('/api/v1/auth/logout'),
  me: () => api.get<User>('/api/v1/auth/me'),
};

// ─── GESTORES ─────────────────────────────────────────────────────────────────
export const gestoresApi = {
  list: (params?: { role?: User['role'] }) => api.get<Gestor[]>('/api/v1/gestores', { params }),
  get: (id: string) => api.get<Gestor>(`/api/v1/gestores/${id}`),
  create: (data: { name: string; legajo?: string }) => api.post<Gestor>('/api/v1/gestores', data),
  evaluaciones: (id: string) => api.get<Evaluation[]>(`/api/v1/gestores/${id}/evaluaciones`),
};

// ─── EVALUACIONES ─────────────────────────────────────────────────────────────
export const evaluacionesApi = {
  list: (params?: EvaluacionesFilters) =>
    api.get<PaginatedResponse<Evaluation>>('/api/v1/evaluaciones', { params }),
  get: (id: string) => api.get<Evaluation>(`/api/v1/evaluaciones/${id}`),
  create: (data: NewEvaluacionData) => api.post<Evaluation>('/api/v1/evaluaciones', data),
  update: (id: string, data: Partial<Evaluation>) =>
    api.put<Evaluation>(`/api/v1/evaluaciones/${id}`, data),
  delete: (id: string) => api.delete(`/api/v1/evaluaciones/${id}`),
  uploadAudio: (id: string, file: File, onProgress?: (progress: number) => void) => {
    const formData = new FormData();
    formData.append('audio', file);
    return api.post<{ message: string; evaluacion: Evaluation }>(
      `/api/v1/evaluaciones/${id}/upload-audio`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          // Keep uploader UI decoupled from Axios internals via a simple percentage callback.
          if (!evt.total || !onProgress) return;
          onProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      },
    );
  },
  status: (id: string) =>
    api.get<{ status: 'processing' | 'ready' | 'error' }>(`/api/v1/evaluaciones/${id}/status`),
  score: (id: string) =>
    api.post<{ message: string; evaluacion: Evaluation }>(`/api/v1/evaluaciones/${id}/score`),
  analyzeDebtor: (id: string) =>
    api.post<{ message: string; evaluacion: Evaluation }>(
      `/api/v1/evaluaciones/${id}/analyze-debtor`,
    ),
  complete: (id: string) =>
    api.post<{ message: string; evaluacion: Evaluation }>(`/api/v1/evaluaciones/${id}/complete`),
  exportPdf: (id: string) =>
    api.get(`/api/v1/evaluaciones/${id}/export-pdf`, { responseType: 'blob' }),
};

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
export const dashboardApi = {
  kpis: () => api.get<DashboardKpis>('/api/v1/dashboard/kpis'),
  trends: (days?: number) =>
    api.get<TrendPoint[]>('/api/v1/dashboard/trends', { params: { days } }),
};

// ─── ADMIN ────────────────────────────────────────────────────────────────────
export const adminApi = {
  users: (params?: AdminUsersFilters) =>
    api.get<AdminUsersResponse>('/api/v1/admin/users', { params }),
  createUser: (data: AdminUserCreateInput) =>
    api.post<AdminUserCreateResponse>('/api/v1/admin/users', data),
  updateUser: (id: string, data: AdminUserUpdateInput) =>
    api.patch<AdminUser>(`/api/v1/admin/users/${id}`, data),
  deleteUser: (id: string) => api.delete<{ message: string }>(`/api/v1/admin/users/${id}`),
};

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string | null;
  email: string;
  name: string;
  role: 'GESTOR' | 'AUDITOR' | 'SUPERVISOR' | 'ADMIN';
  isActive: boolean;
  authProvider: AuthProvider;
  externalAuthId: string | null;
  createdAt: string;
  lastLoginAt?: string | null;
}

export type AuthProvider = 'LOCAL' | 'ACTIVE_DIRECTORY' | 'AZURE_AD';

export interface AdminUser extends User {
  gestorId: string | null;
  updatedAt: string;
  gestor: Pick<Gestor, 'id' | 'name' | 'legajo'> | null;
}

export interface AdminUsersResponse {
  data: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminUsersFilters {
  search?: string;
  role?: User['role'];
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export interface AdminUserCreateInput {
  username: string;
  role: User['role'];
  isActive?: boolean;
  password?: string;
}

export interface AdminUserCreateResponse {
  user: AdminUser;
  temporaryPassword?: string;
}

export type AdminUserUpdateInput = Partial<Omit<AdminUserCreateInput, 'email'>>;

export interface Gestor {
  id: string;
  name: string;
  legajo: string | null;
  _count?: { evaluations: number };
  createdAt: string;
}

export type ScoreValue = 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
export type EvaluationStatus = 'DRAFT' | 'COMPLETED' | 'REVIEWED';
export type ProcessingState = 'PENDING' | 'PROCESSING' | 'READY' | 'ERROR';
export type ContactType = 'TITULAR' | 'TERCERO' | 'NO_CONTACTO';
export type DebtJustification =
  | 'NO_CONOCIA_DEUDA'
  | 'SIN_DINERO'
  | 'DISPUTA_MONTO'
  | 'DESEMPLEO'
  | 'PROBLEMA_SALUD'
  | 'OLVIDO'
  | 'ACUERDO_PREVIO'
  | 'NIEGA_DEUDA'
  | 'PROMESA_PAGO'
  | 'OTRA';
export type ConflictLevel = 'BAJO' | 'MEDIO' | 'ALTO';

export interface ScoreBucketBreakdown {
  label: string;
  weight: number;
  applicable: number;
  cumple: number;
  no_cumple: number;
  no_aplica: number;
  score: number | null;
}

export interface ScoreCalculationBreakdown {
  core: ScoreBucketBreakdown;
  basics: ScoreBucketBreakdown;
  other: ScoreBucketBreakdown;
  normalized_weights: {
    core: number;
    basics: number;
    other: number;
  };
}

export interface EvaluationAiScoringRaw {
  transcript_used_for_scoring?: string;
  scores?: Record<string, unknown>;
  justifications?: Record<string, unknown>;
  modelOutput?: Record<string, unknown>;
  calculation?: {
    formula?: string;
    breakdown?: ScoreCalculationBreakdown;
  };
}

export interface DebtorAnalysis {
  id: string;
  evaluationId: string;
  justificacion_tipo: DebtJustification;
  justificacion_detalle: string;
  promesa_de_pago: boolean;
  fecha_promesa: string | null;
  monto_prometido: number | null;
  nivel_conflicto: ConflictLevel;
  resumen_situacion: string;
  ai_raw_response?: {
    deudor_nombre?: string | null;
    motivo_no_pago_resumen?: string;
    [key: string]: unknown;
  } | null;
  createdAt: string;
}

export interface Evaluation {
  id: string;
  call_id: string;
  account_number: string;
  assignment_number: string;
  contact_type: ContactType;
  assignment_date: string;
  capture_date: string;
  gestorId: string;
  auditorId: string;
  gestor?: Gestor;
  auditor?: Pick<User, 'id' | 'name' | 'email'>;
  audio_filename: string;
  audio_path: string;
  audio_duration_s: number | null;
  transcript: string | null;
  transcript_json: object | null;
  ea_preg_motivo_atraso: ScoreValue;
  ea_sondea_capacidad_pago: ScoreValue;
  ea_utiliza_informacion: ScoreValue;
  res_neg_sentido_urgencia: ScoreValue;
  res_negociacion_total_rr: ScoreValue;
  res_ofrece_herramienta: ScoreValue;
  prev_consecuencias_beneficios: ScoreValue;
  core_apertura: ScoreValue;
  core_control: ScoreValue;
  core_cierre: ScoreValue;
  herr_sigue_politicas: ScoreValue;
  herr_explica_ofrecidas: ScoreValue;
  herr_ofrece_pex: ScoreValue;
  doc_codifica: ScoreValue;
  doc_gestiones_ant: ScoreValue;
  doc_act_demograficos: ScoreValue;
  bas_identificacion: ScoreValue;
  bas_informacion: ScoreValue;
  bas_respeto: ScoreValue;
  bas_veracidad: ScoreValue;
  flag_llamada_cortada: boolean;
  flag_problema_calidad: boolean;
  flag_problema_sonido: boolean;
  flag_sistema_lento: boolean;
  flag_conectividad: boolean;
  flag_empatia_covid: boolean;
  score_core: number;
  score_basics: number;
  score_total: number;
  processing_state: ProcessingState;
  observaciones: string | null;
  debtor_analysis?: DebtorAnalysis | null;
  status: EvaluationStatus;
  ai_scoring_raw: EvaluationAiScoringRaw | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewEvaluacionData {
  call_id?: string;
  account_number?: string;
  assignment_number?: string;
  contact_type?: ContactType;
  assignment_date?: string;
  gestorId: string;
}

export interface EvaluacionesFilters {
  gestorId?: string;
  status?: EvaluationStatus;
  from?: string;
  to?: string;
  minScore?: number;
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  total: number;
}

export interface DashboardKpis {
  totalEvaluaciones: number;
  completadas: number;
  enDraft?: number;
  avgScoreTotal: number;
  avgScoreCore: number;
  avgScoreBasics: number;
  bestScore?: number;
  worstScore?: number;
  topGestores: Array<{
    gestor: Gestor;
    avgScore: number | null;
    totalEvaluaciones: number;
  }>;
}

export interface TrendPoint {
  date: string;
  avgTotal: number;
  avgCore: number;
  avgBasics: number;
  count: number;
}
