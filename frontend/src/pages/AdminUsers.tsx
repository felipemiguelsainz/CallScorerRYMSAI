import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminApi,
  AdminUser,
  AdminUserCreateInput,
  AdminUserUpdateInput,
  User,
} from '../services/api.service';

const ROLE_OPTIONS: User['role'][] = ['ADMIN', 'SUPERVISOR', 'AUDITOR', 'GESTOR'];

interface UserFormState {
  username: string;
  role: User['role'];
  isActive: boolean;
}

const EMPTY_FORM: UserFormState = {
  username: '',
  role: 'AUDITOR',
  isActive: true,
};

export default function AdminUsers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | User['role']>('ALL');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'true' | 'false'>('ALL');

  const [createForm, setCreateForm] = useState<UserFormState>(EMPTY_FORM);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<UserFormState>(EMPTY_FORM);
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

      // Backward-compatibility: older backend versions can return User[] directly.
      if (Array.isArray(raw)) {
        const normalized = raw.map((user) => ({
          ...user,
          isActive: user.isActive ?? true,
          authProvider: user.authProvider ?? 'LOCAL',
          externalAuthId: user.externalAuthId ?? null,
          lastLoginAt: user.lastLoginAt ?? null,
        }));

        return {
          data: normalized,
          total: normalized.length,
          page: 1,
          limit: normalized.length || 100,
        };
      }

      const payload = raw as {
        data?: Array<AdminUser & Partial<Pick<User, 'isActive' | 'authProvider' | 'externalAuthId' | 'lastLoginAt'>>>;
        total?: number;
        page?: number;
        limit?: number;
      };

      const normalized = (payload.data ?? []).map((user) => ({
        ...user,
        isActive: user.isActive ?? true,
        authProvider: user.authProvider ?? 'LOCAL',
        externalAuthId: user.externalAuthId ?? null,
        lastLoginAt: user.lastLoginAt ?? null,
      }));

      return {
        data: normalized,
        total: payload.total ?? normalized.length,
        page: payload.page ?? 1,
        limit: payload.limit ?? 100,
      };
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: AdminUserCreateInput) => adminApi.createUser(payload),
    onSuccess: (response) => {
      setCreateForm(EMPTY_FORM);
      setErrorMessage(null);
      setTemporaryPasswordNotice(response.data.temporaryPassword ?? null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error: { response?: { data?: { error?: string; message?: string } } }) => {
      setErrorMessage(error.response?.data?.error ?? error.response?.data?.message ?? 'No se pudo crear el usuario.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: AdminUserUpdateInput }) =>
      adminApi.updateUser(id, payload),
    onSuccess: () => {
      setEditingUserId(null);
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error: { response?: { data?: { error?: string; message?: string } } }) => {
      setErrorMessage(error.response?.data?.error ?? error.response?.data?.message ?? 'No se pudo actualizar el usuario.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      setEditingUserId(null);
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error: { response?: { data?: { error?: string; message?: string } } }) => {
      setErrorMessage(error.response?.data?.error ?? error.response?.data?.message ?? 'No se pudo eliminar el usuario.');
    },
  });

  const users = usersResponse?.data ?? [];

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setTemporaryPasswordNotice(null);

    const payload: AdminUserCreateInput = {
      username: createForm.username,
      role: createForm.role,
      isActive: createForm.isActive,
    };

    createMutation.mutate(payload);
  }

  function startEdit(user: AdminUser) {
    setEditingUserId(user.id);
    setEditForm({
      username: user.username ?? user.email,
      role: user.role,
      isActive: user.isActive,
    });
    setErrorMessage(null);
  }

  function cancelEdit() {
    setEditingUserId(null);
    setEditForm(EMPTY_FORM);
    setErrorMessage(null);
  }

  function saveEdit(userId: string) {
    const payload: AdminUserUpdateInput = {
      username: editForm.username,
      role: editForm.role,
      isActive: editForm.isActive,
    };

    updateMutation.mutate({ id: userId, payload });
  }

  function deleteUser(user: AdminUser) {
    setErrorMessage(null);
    const label = user.username ?? user.email;
    const confirmed = window.confirm(`¿Seguro que querés eliminar al usuario ${label}? Esta acción no se puede deshacer.`);
    if (!confirmed) return;
    deleteMutation.mutate(user.id);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Administracion de usuarios</h1>
          <p className="text-sm text-gray-500">Gestiona accesos, roles y proveedores de autenticacion.</p>
        </div>
        <span className="text-sm text-gray-500">Total: {usersResponse?.total ?? 0}</span>
      </div>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold text-brand-dark">Crear nuevo usuario</h2>
        <form className="grid md:grid-cols-2 gap-4" onSubmit={handleCreateSubmit}>
          <input
            className="input"
            placeholder="Usuario"
            value={createForm.username}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, username: e.target.value }))}
            required
          />

          <select
            className="input"
            value={createForm.role}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, role: e.target.value as User['role'] }))}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>

          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={createForm.isActive}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, isActive: e.target.checked }))}
            />
            Usuario activo
          </label>

          <button className="btn-primary" type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creando...' : 'Crear usuario'}
          </button>
        </form>

        {temporaryPasswordNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Contraseña temporal generada: <span className="font-semibold">{temporaryPasswordNotice}</span>
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <div className="grid md:grid-cols-3 gap-3">
          <input
            className="input"
            placeholder="Buscar por usuario"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as 'ALL' | User['role'])}>
            <option value="ALL">Todos los roles</option>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
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
                <tr>
                  <td className="py-4 text-gray-500" colSpan={4}>Cargando usuarios...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={4}>No hay usuarios que coincidan con los filtros.</td>
                </tr>
              ) : users.map((user) => {
                const isEditing = editingUserId === user.id;
                return (
                  <tr key={user.id} className="border-b border-gray-100 align-top">
                    <td className="py-3 pr-4 min-w-64">
                      {isEditing ? (
                        <div className="space-y-1">
                          <input
                            className="input"
                            value={editForm.username}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, username: e.target.value }))}
                          />
                        </div>
                      ) : (
                        <div>
                          <p className="font-medium text-gray-900">{user.username ?? user.email}</p>
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {isEditing ? (
                        <select
                          className="input"
                          value={editForm.role}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, role: e.target.value as User['role'] }))}
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                      ) : user.role}
                    </td>
                    <td className="py-3 pr-4">
                      {isEditing ? (
                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={editForm.isActive}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                          />
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
                          <button
                            className="btn-primary"
                            type="button"
                            onClick={() => saveEdit(user.id)}
                            disabled={updateMutation.isPending}
                          >
                            Guardar
                          </button>
                          <button className="btn-secondary" type="button" onClick={cancelEdit}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button className="btn-secondary" type="button" onClick={() => startEdit(user)}>
                            Editar
                          </button>
                          <button
                            className="px-3 py-2 rounded-lg text-sm font-semibold border border-red-200 text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            type="button"
                            onClick={() => deleteUser(user)}
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
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
