import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ForbiddenError, requireRole } from '@/lib/auth/account'
import { PUT as updateFlow, DELETE as deleteFlow } from './flows/[id]/route'
import { POST as changeFlowStatus } from './flows/[id]/activate/route'
import { POST as openBillingPortal } from './billing/portal/route'
import { POST as createAutomation } from './automations/route'
import { POST as dispatchAutomation } from './automations/engine/route'
import {
  PATCH as updateAutomation,
  DELETE as deleteAutomation,
} from './automations/[id]/route'
import { POST as duplicateAutomation } from './automations/[id]/duplicate/route'

vi.mock('@/lib/auth/account', () => {
  class MockForbiddenError extends Error {
    readonly status = 403
  }
  class MockUnauthorizedError extends Error {
    readonly status = 401
  }
  return {
    ForbiddenError: MockForbiddenError,
    UnauthorizedError: MockUnauthorizedError,
    requireRole: vi.fn(),
    toErrorResponse: (error: Error & { status?: number }) =>
      new Response(JSON.stringify({ error: error.message }), {
        status: error.status ?? 500,
      }),
  }
})

vi.mock('@/lib/stripe/client', () => ({
  stripe: {
    billingPortal: { sessions: { create: vi.fn() } },
  },
}))

function routeParams(id = 'resource-1') {
  return { params: Promise.resolve({ id }) }
}

describe('write endpoint role guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockRejectedValue(
      new ForbiddenError('This action requires the agent role or higher'),
    )
  })

  const protectedActions: Array<{
    name: string
    expectedRole: 'agent' | 'admin'
    invoke: () => Promise<Response>
  }> = [
    {
      name: 'flow update',
      expectedRole: 'agent',
      invoke: () =>
        updateFlow(
          new Request('http://localhost/api/flows/resource-1', {
            method: 'PUT',
            body: JSON.stringify({ name: 'Updated' }),
          }),
          routeParams(),
        ),
    },
    {
      name: 'flow deletion',
      expectedRole: 'agent',
      invoke: () =>
        deleteFlow(new Request('http://localhost/api/flows/resource-1'), routeParams()),
    },
    {
      name: 'flow activation',
      expectedRole: 'agent',
      invoke: () =>
        changeFlowStatus(
          new Request('http://localhost/api/flows/resource-1/activate', {
            method: 'POST',
            body: JSON.stringify({ status: 'active' }),
          }),
          routeParams(),
        ),
    },
    {
      name: 'billing portal access',
      expectedRole: 'admin',
      invoke: () =>
        openBillingPortal(
          new NextRequest('http://localhost/api/billing/portal', { method: 'POST' }),
        ),
    },
    {
      name: 'automation creation',
      expectedRole: 'agent',
      invoke: () =>
        createAutomation(
          new Request('http://localhost/api/automations', {
            method: 'POST',
            body: JSON.stringify({ name: 'Test', trigger_type: 'manual' }),
          }),
        ),
    },
    {
      name: 'manual automation dispatch',
      expectedRole: 'agent',
      invoke: () =>
        dispatchAutomation(
          new Request('http://localhost/api/automations/engine', {
            method: 'POST',
            body: JSON.stringify({ trigger_type: 'manual' }),
          }),
        ),
    },
    {
      name: 'automation update',
      expectedRole: 'agent',
      invoke: () =>
        updateAutomation(
          new Request('http://localhost/api/automations/resource-1', {
            method: 'PATCH',
            body: JSON.stringify({ name: 'Updated' }),
          }),
          routeParams(),
        ),
    },
    {
      name: 'automation deletion',
      expectedRole: 'agent',
      invoke: () =>
        deleteAutomation(
          new Request('http://localhost/api/automations/resource-1', {
            method: 'DELETE',
          }),
          routeParams(),
        ),
    },
    {
      name: 'automation duplication',
      expectedRole: 'agent',
      invoke: () =>
        duplicateAutomation(
          new Request('http://localhost/api/automations/resource-1/duplicate', {
            method: 'POST',
          }),
          routeParams(),
        ),
    },
  ]

  it.each(protectedActions)(
    'rejects viewers before performing $name',
    async ({ invoke, expectedRole }) => {
      const response = await invoke()

      expect(response.status).toBe(403)
      expect(requireRole).toHaveBeenCalledWith(expectedRole)
    },
  )
})
