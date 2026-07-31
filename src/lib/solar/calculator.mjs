// The browser and the Supabase Edge Function use the same calculation source.
// Keeping this re-export prevents formula drift between displayed and persisted
// quote results.
export * from '../../../supabase/functions/_shared/calculator.mjs';
