import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, FileText, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import {
  adminApi,
  AdminUser,
  AdminUserCreateInput,
  AdminUserUpdateInput,
  User,
  clientesApi,
  evaluacionesApi,
  Evaluation,
  Cliente,
  ClienteCreateInput,
} from '../services/api.service';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

const ROLE_OPTIONS: User['role'][] = ['ADMIN', 'SUPERVISOR', 'AUDITOR', 'GESTOR'];
const EMOJI_OPTIONS = ['🏦', '💳', '🏢', '🏛️', '🌐', '💰', '🏪', '🔷', '⭐', '🎯'];

type Tab = 'usuarios' | 'clientes' | 'evaluaciones';

interface UserFormState {
  username: string;
  name: string;
  role: User['role'];
  isActive: boolean;
  password: string;
}

const EMPTY_USER_FORM: UserFormState = { username: '', name: '', role: 'AUDITOR', isActive: true, password: '' };
interface ClienteForm {
  nombre: string;
  codigo: string;
  icono: string;
  isActive: boolean;
}

const EMPTY_CLIENTE_FORM: ClienteForm = { nombre: '', codigo: '', icono: '🏢', isActive: true };

// ─── PANEL PRINCIPAL ──────────────────────────────────────────────────────────

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('usuarios');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">Panel de Administración</h1>
        <p className="text-sm text-gray-500 mt-1">Gestioná usuarios y clientes del sistema.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <TabButton active={activeTab === 'usuarios'} onClick={() => setActiveTab('usuarios')} icon={<Users size={15} />}>
          Usuarios
        </TabButton>
        <TabButton active={activeTab === 'clientes'} onClick={() => setActiveTab('clientes')} icon={<Building2 size={15} />}>
          Clientes
        </TabButton>
        <TabButton active={activeTab === 'evaluaciones'} onClick={() => setActiveTab('evaluaciones')} icon={<FileText size={15} />}>
          Evaluaciones
        </TabButton>
      </div>

      {activeTab === 'usuarios' ? <TabUsuarios /> : activeTab === 'clientes' ? <TabClientes /> : <TabEvaluaciones />}
    </div>
  );
}

function TabButton({
  children,
  active,
  onClick,
  icon,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? 'border-brand-red text-brand-red'
          : 'border-transparent text-gray-500 hover:text-brand-dark hover:border-gray-300'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── TAB USUARIOS ─────────────────────────────────────────────────────────────

function TabUsuarios() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | User['role']>('ALL');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'true' | 'false'>('ALL');
  const [createForm, setCreateForm] = useState<UserFormState>(EMPTY_USER_FORM);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<UserFormState>(EMPTY_USER_FORM);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [temporaryPasswordNotice, setTemporaryPasswordNotice] = useState<string | null>(null);

  const queryParams = useMemo(
    () => ({
      search: search || undefined,
      role: roleFilter === 'ALL' ? undefined : roleFilter,
      isActive: activeFilter === 'ALL' ? undefined : activeFilter === 'true',
      limit: 100,
    }),
    [search, roleFilter, activeFilter],
  );

  const { data: usersResponse, isLoading } = useQuery({
    queryKey: ['admin-users', queryParams],
    queryFn: async () => {
      const response = await adminApi.users(queryParams);
      const raw = response.data as unknown;
      if (Array.isArray(raw)) {
        const normalized = raw.map((u) => ({
          ...u,
          isActive: u.isActive ?? true,
          authProvider: u.authProvider ?? 'LOCAL',
          externalAuthId: u.externalAuthId ?? null,
          lastLoginAt: u.lastLoginAt ?? null,
        }));
        return { data: normalized, total: normalized.length, page: 1, limit: normalized.length || 100 };
      }
      const payload = raw as { data?: AdminUser[]; total?: number; page?: number; limit?: number };
      const normalized = (payload.data ?? []).map((u) => ({
        ...u,
        isActive: u.isActive ?? true,
        authProvider: u.authProvider ?? 'LOCAL',
        externalAuthId: u.externalAuthId ?? null,
        lastLoginAt: u.lastLoginAt ?? null,
      }));
      return { data: normalized, total: payload.total ?? normalized.length, page: payload.page ?? 1, limit: payload.limit ?? 100 };
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: AdminUserCreateInput) => adminApi.createUser(payload),
    onSuccess: (response) => {
      setCreateForm(EMPTY_USER_FORM);
      setErrorMessage(null);
      setTemporaryPasswordNotice(response.data.temporaryPassword ?? null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err: { response?: { data?: { error?: string; message?: string } } }) => {
      setErrorMessage(err.response?.data?.error ?? err.response?.data?.message ?? 'No se pudo crear el usuario.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: AdminUserUpdateInput }) => adminApi.updateUser(id, payload),
    onSuccess: () => { setEditingUserId(null); setErrorMessage(null); queryClient.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (err: { response?: { data?: { error?: string; message?: string } } }) => {
      setErrorMessage(err.response?.data?.error ?? err.response?.data?.message ?? 'No se pudo actualizar.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => { setEditingUserId(null); setErrorMessage(null); queryClient.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (err: { response?: { data?: { error?: string; message?: string } } }) => {
      setErrorMessage(err.response?.data?.error ?? 'No se pudo eliminar.');
    },
  });

  const users = usersResponse?.data ?? [];

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setTemporaryPasswordNotice(null);
    createMutation.mutate({ username: createForm.username, role: createForm.role, isActive: createForm.isActive });
  }

  function startEdit(user: AdminUser) {
    setEditingUserId(user.id);
    setEditForm({ username: user.username ?? user.email, name: user.name ?? '', role: user.role, isActive: user.isActive, password: '' });
    setErrorMessage(null);
  }

  function saveEdit(userId: string) {
    updateMutation.mutate({ id: userId, payload: {
      username: editForm.username,
      name: editForm.name || undefined,
      role: editForm.role,
      isActive: editForm.isActive,
      ...(editForm.password ? { password: editForm.password } : {}),
    }});
  }

  function deleteUser(user: AdminUser) {
    if (!window.confirm(`¿Eliminar al usuario ${user.username ?? user.email}? Esta acción no se puede deshacer.`)) return;
    deleteMutation.mutate(user.id);
  }

  return (
    <div className="space-y-6">
      {/* Crear usuario */}
      <section className="card space-y-4">
        <h2 className="text-base font-semibold text-brand-dark">Crear nuevo usuario</h2>
        <form className="grid md:grid-cols-2 gap-4" onSubmit={handleCreateSubmit}>
          <input className="input" placeholder="Usuario" value={createForm.username} onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))} required />
          <select className="input" value={createForm.role} onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value as User['role'] }))}>
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={createForm.isActive} onChange={(e) => setCreateForm((p) => ({ ...p, isActive: e.target.checked }))} />
            Usuario activo
          </label>
          <button className="btn-primary" type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creando...' : 'Crear usuario'}
          </button>
        </form>
        {temporaryPasswordNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Contraseña temporal: <span className="font-semibold">{temporaryPasswordNotice}</span>
          </div>
        )}
      </section>

      {/* Lista */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-brand-dark">Usuarios</h2>
          <span className="text-sm text-gray-500">Total: {usersResponse?.total ?? 0}</span>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <input className="input" placeholder="Buscar por usuario" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as 'ALL' | User['role'])}>
            <option value="ALL">Todos los roles</option>
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="input" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as 'ALL' | 'true' | 'false')}>
            <option value="ALL">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
        </div>
        {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 border-b border-gray-200">
                <th className="pb-2 pr-4">Usuario</th>
                <th className="pb-2 pr-4">Rol</th>
                <th className="pb-2 pr-4">Estado</th>
                <th className="pb-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="py-4 text-gray-500" colSpan={4}>Cargando...</td></tr>
              ) : users.length === 0 ? (
                <tr><td className="py-4 text-gray-500" colSpan={4}>Sin resultados.</td></tr>
              ) : users.map((user) => {
                const isEditing = editingUserId === user.id;
                return (
                  <tr key={user.id} className="border-b border-gray-100 align-top">
                    <td className="py-3 pr-4 min-w-48">
                      {isEditing ? (
                        <div className="space-y-1">
                          <div>
                            <p className="text-xs text-gray-400 mb-0.5">Usuario (login)</p>
                            <input className="input" value={editForm.username} onChange={(e) => setEditForm((p) => ({ ...p, username: e.target.value }))} />
                          </div>
                          <div>
                            <p className="text-xs text-gray-400 mb-0.5">Nombre completo</p>
                            <input className="input" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
                          </div>
                          <div>
                            <p className="text-xs text-gray-400 mb-0.5">Nueva contraseña (vacío = sin cambio)</p>
                            <input className="input" type="password" value={editForm.password} onChange={(e) => setEditForm((p) => ({ ...p, password: e.target.value }))} />
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="font-medium text-gray-900">{user.name || user.username || user.email}</p>
                          <p className="text-xs text-gray-400">{user.username ?? user.email}</p>
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {isEditing ? (
                        <select className="input" value={editForm.role} onChange={(e) => setEditForm((p) => ({ ...p, role: e.target.value as User['role'] }))}>
                          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : user.role}
                    </td>
                    <td className="py-3 pr-4">
                      {isEditing ? (
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={editForm.isActive} onChange={(e) => setEditForm((p) => ({ ...p, isActive: e.target.checked }))} />
                          Activo
                        </label>
                      ) : (
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>
                          {user.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                      )}
                    </td>
                    <td className="py-3">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <button className="btn-primary" onClick={() => saveEdit(user.id)} disabled={updateMutation.isPending}>Guardar</button>
                          <button className="btn-secondary" onClick={() => { setEditingUserId(null); setErrorMessage(null); }}>Cancelar</button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button className="btn-secondary" onClick={() => startEdit(user)}>Editar</button>
                          <button className="px-3 py-2 rounded-lg text-sm font-semibold border border-red-200 text-red-700 hover:bg-red-50 transition-colors" onClick={() => deleteUser(user)} disabled={deleteMutation.isPending}>
                            Eliminar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ─── TAB CLIENTES ─────────────────────────────────────────────────────────────

function TabClientes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'true' | 'false'>('ALL');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ClienteForm>(EMPTY_CLIENTE_FORM);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const queryParams = {
    search: search || undefined,
    isActive: activeFilter === 'ALL' ? undefined : activeFilter === 'true',
  };

  const { data, isLoading } = useQuery({
    queryKey: ['clientes', queryParams],
    queryFn: () => clientesApi.list(queryParams).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (input: ClienteCreateInput) => clientesApi.create(input),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['clientes'] }); closeModal(); },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      setErrorMessage(err.response?.data?.error ?? 'Error al crear cliente');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClienteCreateInput }) => clientesApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['clientes'] }); closeModal(); },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      setErrorMessage(err.response?.data?.error ?? 'Error al actualizar');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientesApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clientes'] }),
  });

  function openCreate() { setEditingId(null); setForm(EMPTY_CLIENTE_FORM); setErrorMessage(null); setShowModal(true); }
  function openEdit(c: Cliente) { setEditingId(c.id); setForm({ nombre: c.nombre, codigo: c.codigo ?? '', icono: c.icono ?? '🏢', isActive: c.isActive }); setErrorMessage(null); setShowModal(true); }
  function closeModal() { setShowModal(false); setEditingId(null); setForm(EMPTY_CLIENTE_FORM); setErrorMessage(null); }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    if (!form.nombre.trim()) { setErrorMessage('El nombre es obligatorio'); return; }
    const payload: ClienteCreateInput = { ...form, codigo: (form.codigo || form.nombre.substring(0, 6)).toUpperCase() };
    if (editingId) updateMutation.mutate({ id: editingId, data: payload });
    else createMutation.mutate(payload);
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-3">
          <input type="text" placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} className="input max-w-xs" />
          <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as 'ALL' | 'true' | 'false')} className="input w-auto">
            <option value="ALL">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nuevo Cliente
        </button>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="card animate-pulse h-44 bg-gray-100" />)}
        </div>
      ) : !data?.data.length ? (
        <div className="card text-center py-14 text-gray-400">
          <Building2 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No hay clientes aún. Creá el primero.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {data.data.map((c) => (
            <div key={c.id} className="card flex flex-col items-center gap-2 py-5">
              <div className="text-5xl">{c.icono ?? '🏢'}</div>
              <div className="text-center">
                <p className="font-bold text-brand-dark leading-tight text-sm">{c.nombre}</p>
                {c.codigo && <p className="text-xs text-gray-400 font-mono mt-0.5">{c.codigo}</p>}
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {c.isActive ? 'Activo' : 'Inactivo'}
              </span>
              {c._count && <p className="text-xs text-gray-400">{c._count.evaluations} evaluaciones</p>}
              <div className="flex gap-2 mt-auto pt-1">
                <button onClick={() => openEdit(c)} className="btn-secondary flex items-center gap-1 text-xs px-3 py-1.5">
                  <Pencil size={12} /> Editar
                </button>
                <button
                  onClick={() => { if (confirm(`¿Eliminar a ${c.nombre}?`)) deleteMutation.mutate(c.id); }}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={12} /> Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="font-bold text-brand-dark">{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                <input type="text" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} className="input" placeholder="Ej: American Express" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código <span className="text-gray-400 font-normal">(opcional)</span></label>
                <input type="text" value={form.codigo} onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))} className="input font-mono" placeholder="Ej: AMEX" maxLength={50} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Ícono</label>
                <div className="grid grid-cols-5 gap-2">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => setForm((f) => ({ ...f, icono: emoji }))}
                      className={`text-2xl p-2 rounded-lg border-2 transition-colors ${form.icono === emoji ? 'border-brand-red bg-red-50' : 'border-gray-200 hover:border-gray-400'}`}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                Activo
              </label>
              {errorMessage && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{errorMessage}</p>}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={isSaving} className="btn-primary flex-1">
                  {isSaving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear cliente'}
                </button>
                <button type="button" onClick={closeModal} className="btn-secondary">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB EVALUACIONES ─────────────────────────────────────────────────────────

function TabEvaluaciones() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ERROR' | 'PROCESSING' | 'PENDING' | 'READY'>('ALL');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-evaluaciones'],
    queryFn: () => evaluacionesApi.list({ limit: 100 }).then((r) => r.data),
  });

  const evaluaciones = useMemo(() => {
    const all = data?.data ?? [];
    return all.filter((e) => {
      if (statusFilter !== 'ALL' && e.processing_state !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!e.call_id?.toLowerCase().includes(q) && !e.account_number?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [data, search, statusFilter]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => evaluacionesApi.delete(id),
    onSuccess: () => {
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ['admin-evaluaciones'] });
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      setErrorMsg(err.response?.data?.error ?? 'No se pudo eliminar.');
    },
  });

  const requeueMutation = useMutation({
    mutationFn: (id: string) => evaluacionesApi.requeue(id),
    onSuccess: () => {
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ['admin-evaluaciones'] });
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      setErrorMsg(err.response?.data?.error ?? 'No se pudo reintentar.');
    },
  });

  const scoreMutation = useMutation({
    mutationFn: (id: string) => evaluacionesApi.score(id),
    onSuccess: () => {
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ['admin-evaluaciones'] });
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      setErrorMsg(err.response?.data?.error ?? 'No se pudo puntuar.');
    },
  });

  function handleDelete(ev: Evaluation) {
    if (!window.confirm(`¿Eliminar la evaluación ${ev.call_id}? Esta acción no se puede deshacer.`)) return;
    deleteMutation.mutate(ev.id);
  }

  const statusLabel: Record<string, string> = {
    PENDING: 'Pendiente',
    PROCESSING: 'Procesando',
    READY: 'Lista',
    ERROR: 'Error',
  };
  const statusColor: Record<string, string> = {
    PENDING: 'bg-gray-100 text-gray-600',
    PROCESSING: 'bg-blue-100 text-blue-700',
    READY: 'bg-green-100 text-green-700',
    ERROR: 'bg-red-100 text-red-700',
  };

  function getStatusLabel(ev: Evaluation) {
    return statusLabel[ev.processing_state] ?? ev.processing_state;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <input
          className="input flex-1"
          placeholder="Buscar por call_id o número de cuenta..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input w-44"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="ALL">Todos los estados</option>
          <option value="ERROR">Error</option>
          <option value="PROCESSING">Procesando</option>
          <option value="PENDING">Pendiente</option>
          <option value="READY">Lista</option>
        </select>
      </div>

      {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold text-gray-500 border-b border-gray-200">
              <th className="pb-2 pr-4">Call ID</th>
              <th className="pb-2 pr-4">Gestor</th>
              <th className="pb-2 pr-4">Estado</th>
              <th className="pb-2 pr-4">Fecha</th>
              <th className="pb-2">Acción</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="py-4 text-gray-500">Cargando...</td></tr>
            ) : evaluaciones.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-gray-500">Sin resultados.</td></tr>
            ) : evaluaciones.map((ev) => (
              <tr key={ev.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2.5 pr-4 font-medium text-gray-900 max-w-[200px] truncate">{ev.call_id}</td>
                <td className="py-2.5 pr-4 text-gray-600 max-w-[140px] truncate">{ev.gestor?.name ?? ev.gestorId}</td>
                <td className="py-2.5 pr-4">
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${statusColor[ev.processing_state] ?? 'bg-gray-100 text-gray-600'}`}>
                    {getStatusLabel(ev)}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-gray-500 text-xs">
                  {new Date(ev.createdAt).toLocaleDateString('es-AR')}
                </td>
                <td className="py-2.5">
                  <div className="flex gap-1.5">
                    {ev.processing_state === 'ERROR' && (
                      <button
                        className="px-2 py-1 rounded text-xs font-semibold border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50"
                        onClick={() => requeueMutation.mutate(ev.id)}
                        disabled={requeueMutation.isPending}
                      >
                        Reintentar
                      </button>
                    )}
                    {ev.processing_state === 'READY' && Number(ev.score_total) === 0 && (
                      <button
                        className="px-2 py-1 rounded text-xs font-semibold border border-amber-200 text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
                        onClick={() => scoreMutation.mutate(ev.id)}
                        disabled={scoreMutation.isPending}
                      >
                        Puntuar
                      </button>
                    )}
                    <button
                      className="px-2 py-1 rounded text-xs font-semibold border border-red-200 text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
                      onClick={() => handleDelete(ev)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 size={13} className="inline mr-1" />
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
