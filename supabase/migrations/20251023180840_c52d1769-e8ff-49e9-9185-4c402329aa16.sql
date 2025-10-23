-- Create a simple table to initialize the database schema
CREATE TABLE IF NOT EXISTS public.app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Policy to allow reading
CREATE POLICY "Allow public read access" ON public.app_settings
  FOR SELECT USING (true);