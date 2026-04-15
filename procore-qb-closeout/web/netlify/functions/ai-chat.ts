import { Handler } from '@netlify/functions'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'AI service not configured' }),
    }
  }

  try {
    const { message, contextData, history } = JSON.parse(event.body || '{}')

    if (!message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message is required' }),
      }
    }

    // Build context for the AI
    let systemContext = `You are an AI assistant helping with financial reconciliation between Procore (construction project management) and QuickBooks Online (accounting software).

You help construction finance professionals understand their project financials, identify discrepancies, and explain reconciliation data.

Key concepts:
- Sub Invoices: Bills from subcontractors for work performed
- Payment Applications / Owner Invoices: Requests for payment sent to the project owner
- Commitments: Subcontracts and Purchase Orders with vendors
- Direct Costs: Non-commitment costs like materials, equipment, labor
- Retainage: Amount held back from payments (typically 5-10%) until project completion
- Soft Close: Project has reached substantial completion but has outstanding financial tails
- Hard Close: Project is fully closed with all financials reconciled
- WIP Report: Work In Progress report - monthly snapshot of project financials

Be concise, helpful, and use construction finance terminology appropriately.`

    if (contextData) {
      systemContext += `\n\nProject Context:\n${JSON.stringify(contextData, null, 2)}`
    }

    // Build message history
    const messages: { role: 'user' | 'assistant'; content: string }[] = []

    if (history && Array.isArray(history)) {
      for (const h of history) {
        if (h.role === 'user' || h.role === 'assistant') {
          messages.push({ role: h.role, content: h.content })
        }
      }
    }

    // Add the current message
    messages.push({ role: 'user', content: message })

    // Call Anthropic API directly using fetch
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemContext,
        messages: messages,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Anthropic API error:', errorText)
      throw new Error(`AI API error: ${response.status}`)
    }

    const data = await response.json()
    const textContent = data.content?.find((c: any) => c.type === 'text')
    const responseText = textContent?.text || 'I was unable to generate a response.'

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ response: responseText }),
    }
  } catch (error: any) {
    console.error('AI Chat error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Failed to process request' }),
    }
  }
}
