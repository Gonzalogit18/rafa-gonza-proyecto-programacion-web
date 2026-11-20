-- Vías de cobro nuevas: Superintendencia de Salud, convenio directo con ART y módulo de discapacidad por CUD
alter table public.obras_sociales drop constraint if exists obras_sociales_default_via_check;
alter table public.obras_sociales add constraint obras_sociales_default_via_check
  check (default_via in ('convenio','colegio','reintegro','superintendencia','convenio_art','modulo_cud'));
alter table public.treatments drop constraint if exists treatments_via_check;
alter table public.treatments add constraint treatments_via_check
  check (via in ('convenio','colegio','reintegro','superintendencia','convenio_art','modulo_cud'));
alter table public.tariffs drop constraint if exists tariffs_tariff_check;
alter table public.tariffs add constraint tariffs_tariff_check
  check (tariff in ('discapacidad_nacional','discapacidad_ioma','discapacidad_provincial','incluir_salud',
                    'colegio','convenio','pami','ioma','art','seguro','particular','superintendencia'));
