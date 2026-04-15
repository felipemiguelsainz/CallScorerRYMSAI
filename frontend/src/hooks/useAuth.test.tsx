/// <reference types="vitest" />
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './useAuth';

const loginMock = vi.fn();
const meMock = vi.fn();
const logoutMock = vi.fn();

vi.mock('../services/api.service', () => ({
  authApi: {
    login: (...args: unknown[]) => loginMock(...args),
    me: (...args: unknown[]) => meMock(...args),
    logout: (...args: unknown[]) => logoutMock(...args),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('useAuth', () => {
  beforeEach(() => {
    loginMock.mockReset();
    meMock.mockReset();
    logoutMock.mockReset();
  });

  it('hydrates user from /me on mount', async () => {
    meMock.mockResolvedValueOnce({
      data: {
        id: 'u1',
        username: 'admin',
        email: 'admin@local.user',
        name: 'admin',
        role: 'ADMIN',
        isActive: true,
        authProvider: 'LOCAL',
        externalAuthId: null,
        createdAt: new Date().toISOString(),
      },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.email).toBe('admin@local.user');
  });

  it('updates auth state after login', async () => {
    meMock.mockRejectedValueOnce(new Error('no session'));
    loginMock.mockResolvedValueOnce({
      data: {
        user: {
          id: 'u2',
          username: 'gestor',
          email: 'gestor@local.user',
          name: 'gestor',
          role: 'GESTOR',
          isActive: true,
          authProvider: 'LOCAL',
          externalAuthId: null,
          createdAt: new Date().toISOString(),
        },
      },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login('gestor', 'password123');
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.username).toBe('gestor');
  });
});
