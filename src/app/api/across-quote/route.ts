import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Extract all the query parameters
    const inputToken = searchParams.get('inputToken');
    const outputToken = searchParams.get('outputToken');
    const inputAmount = searchParams.get('inputAmount');
    const originChainId = searchParams.get('originChainId');
    const destinationChainId = searchParams.get('destinationChainId');
    const tradeType = searchParams.get('tradeType') || 'exactInput';
    const recipient = searchParams.get('recipient');

    // Build the Across API URL
    // Note: Across API uses 'amount' not 'inputAmount'
    const acrossUrl = new URL('https://testnet.across.to/api/suggested-fees');
    acrossUrl.searchParams.set('inputToken', inputToken || '');
    acrossUrl.searchParams.set('outputToken', outputToken || '');
    acrossUrl.searchParams.set('amount', inputAmount || ''); // Across API expects 'amount'
    acrossUrl.searchParams.set('originChainId', originChainId || '');
    acrossUrl.searchParams.set('destinationChainId', destinationChainId || '');
    acrossUrl.searchParams.set('recipient', recipient || '');

    // Make the request to Across API from the server
    const response = await fetch(acrossUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Across API error:', response.status, errorText);
      return NextResponse.json(
        { error: `Across API returned ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('Error fetching Across quote:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch quote' },
      { status: 500 }
    );
  }
}

