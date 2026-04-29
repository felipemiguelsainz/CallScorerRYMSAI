import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Trash2, X, Plus } from 'lucide-react';
import { clientesApi, Cliente, ClienteCreateInput } from '../services/api.service';

const EMOJI_OPTIONS = ['🏦', '💳', '🏢', '🏛️', '🌐', '💰', '🏪', '🔷', '⭐', '🎯'];

interface ClienteForm {
  nombre: string;
  codigo: string;
  icono: string;
  isActive: boolean;
}

const EMPTY_FORM: ClienteForm = {
  nombre: '',
  codigo: '',
  icono: '🏢',
  isActive: true,
};

export default function AdminClientes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'true' | 'false'>('ALL');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ClienteForm>(EMPTY_FORM);
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
      setErrorMessage(err.response?.data?.error ?? 'Error al actualizar cliente');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientesApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clientes'] }),
  });

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrorMessage(null);
    setShowModal(true);
  }

  function openEdit(c: Cliente) {
    setEditingId(c.id);
    setForm({ nombre: c.nombre, codigo: c.codigo, icono: c.icono ?? '🏢', isActive: c.isActive });
    setErrorMessage(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrorMessage(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    if (!form.nombre.trim() || !form.codigo.trim()) {
      setErrorMessage('Nombre y código son obligatorios');
      return;
    }
    const payload: ClienteCreateInput = { ...form, codigo: form.codigo.toUpperCase() };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-dark flex items-center gap-2">
          <Building2 size={24} className="text-brand-red" />
          Gestión de Clientes
        </h1>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} />
          Nuevo Cliente
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Buscar por nombre o código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-xs"
        />
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as 'ALL' | 'true' | 'false')}
          className="input w-auto"
        >
          <option value="ALL">Todos los estados</option>
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
        </select>
      </div>

      {/* Grid de tarjetas */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card animate-pulse h-40 bg-gray-100" />
          ))}
        </div>
      ) : data?.data.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <Building2 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No hay clientes registrados</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {data?.data.map((cliente) => (
            <div key={cliente.id} className="card flex flex-col items-center gap-3 relative">
              <div className="text-5xl">{cliente.icono ?? '🏢'}</div>
              <div className="text-center">
                <p className="font-bold text-brand-dark leading-tight">{cliente.nombre}</p>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{cliente.codigo}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cliente.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {cliente.isActive ? 'Activo' : 'Inactivo'}
              </span>
              {cliente._count && (
                <p className="text-xs text-gray-400">{cliente._count.evaluations} evaluaciones</p>
              )}
              <div className="flex gap-2 mt-auto">
                <button
                  onClick={() => openEdit(cliente)}
                  className="btn-secondary flex items-center gap-1 text-xs px-3 py-1.5"
                >
                  <Pencil size={12} /> Editar
                </button>
                <button
                  onClick={() => { if (confirm(`¿Eliminar a ${cliente.nombre}?`)) deleteMutation.mutate(cliente.id); }}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={12} /> Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal crear/editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="font-bold text-brand-dark">
                {editingId ? 'Editar Cliente' : 'Nuevo Cliente'}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                  className="input"
                  placeholder="Ej: American Express"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código</label>
                <input
                  type="text"
                  value={form.codigo}
                  onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
                  className="input font-mono"
                  placeholder="Ej: AMEX"
                  maxLength={50}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Ícono</label>
                <div className="grid grid-cols-5 gap-2">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, icono: emoji }))}
                      className={`text-2xl p-2 rounded-lg border-2 transition-colors ${form.icono === emoji ? 'border-brand-red bg-red-50' : 'border-gray-200 hover:border-gray-400'}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="rounded border-gray-300"
                />
                <label htmlFor="isActive" className="text-sm text-gray-700">Activo</label>
              </div>
              {errorMessage && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{errorMessage}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={isSaving} className="btn-primary flex-1">
                  {isSaving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear cliente'}
                </button>
                <button type="button" onClick={closeModal} className="btn-secondary">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
