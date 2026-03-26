import React, { useState } from 'react';

export default function RepairStatusTracker() {
  const [ticketId, setTicketId] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketId.trim()) {
      setError('Please enter a ticket ID');
      return;
    }

    setLoading(true);
    setError(null);
    setStatus(null);

    // Simulate API call - replace with actual API endpoint
    setTimeout(() => {
      // Mock response - in production, this would fetch from your API
      const mockStatuses: { [key: string]: string } = {
        'TICKET-001': 'In Progress - Device diagnostics completed',
        'TICKET-002': 'Ready for Pickup - Repair completed',
        'TICKET-003': 'Pending - Waiting for parts',
      };

      const result = mockStatuses[ticketId.toUpperCase()];
      if (result) {
        setStatus(result);
      } else {
        setError('Ticket not found. Please check your ticket ID.');
      }
      setLoading(false);
    }, 500);
  };

  return (
    <section className="w-full py-16 px-4 bg-white border-t border-b border-slate-200">
      <div className="max-w-2xl mx-auto">
        <div className="bg-slate-50 rounded-lg p-8 border-2 border-blue-600">
          <h2 className="text-3xl font-bold text-slate-900 mb-2">Track Your Repair</h2>
          <p className="text-slate-600 mb-6">
            Enter your ticket ID to check the status of your device repair
          </p>

          <form onSubmit={handleSearch} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                placeholder="Enter ticket ID (e.g., TICKET-001)"
                className="flex-1 px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 text-slate-900"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-bold py-3 px-8 rounded-lg transition-colors duration-200 whitespace-nowrap"
              >
                {loading ? 'Searching...' : 'Track Status'}
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 font-medium">{error}</p>
            </div>
          )}

          {status && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-900 font-medium">
                <span className="text-lg">✓ </span>{status}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
