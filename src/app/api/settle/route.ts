import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Get the X-PAYMENT header from the request
    const xPaymentHeader = request.headers.get('X-PAYMENT');
    const authHeader = request.headers.get('Authorization');
    
    if (!xPaymentHeader) {
      return NextResponse.json(
        { error: 'Missing X-PAYMENT header' },
        { status: 400 }
      );
    }

    // Forward the request to the facilitator API
    const facilitatorUrl = 'https://api.mrdn.finance/v1/settle';
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-PAYMENT': xPaymentHeader,
    };

    // Include Authorization header if present
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    console.log('Proxying request to facilitator:', facilitatorUrl);
    console.log('Body:', JSON.stringify(body, null, 2));

    const response = await fetch(facilitatorUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Facilitator API error:', response.status, errorText);
      return NextResponse.json(
        { error: `Facilitator API returned ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // Get the X-PAYMENT-RESPONSE header if present
    const xPaymentResponse = response.headers.get('X-PAYMENT-RESPONSE');
    
    const responseHeaders: Record<string, string> = {
      'Cache-Control': 'no-store, max-age=0',
    };
    
    if (xPaymentResponse) {
      responseHeaders['X-PAYMENT-RESPONSE'] = xPaymentResponse;
      responseHeaders['Access-Control-Expose-Headers'] = 'X-PAYMENT-RESPONSE';
    }
    
    return NextResponse.json(data, {
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Error proxying settle request:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to proxy settle request' },
      { status: 500 }
    );
  }
}

