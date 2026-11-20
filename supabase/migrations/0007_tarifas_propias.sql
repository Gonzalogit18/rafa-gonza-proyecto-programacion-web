-- Tarifas con el nombre que quiera cada clínica. Un tratamiento puede elegir una y deja de usar la tabla de las reglas.
alter table public.tariffs add column if not exists custom_name text;
alter table public.tariffs drop constraint if exists tariffs_tariff_check;
alter table public.tariffs add constraint tariffs_tariff_check
  check (tariff in ('discapacidad_nacional','discapacidad_ioma','discapacidad_provincial','incluir_salud',
                    'colegio','convenio','pami','ioma','art','seguro','particular','superintendencia','propia'));
alter table public.treatments add column if not exists custom_tariff text;
