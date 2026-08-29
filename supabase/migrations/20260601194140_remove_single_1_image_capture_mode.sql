update public.app_settings
set capture_mode = 'single_2_image'
where capture_mode = 'single_1_image';

update public.listings
set capture_mode = 'single_2_image'
where capture_mode = 'single_1_image';
