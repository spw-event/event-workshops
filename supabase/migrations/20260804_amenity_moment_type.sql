alter table open_moments
drop constraint if exists open_moments_moment_type_check;

alter table open_moments
add constraint open_moments_moment_type_check
check (moment_type in ('mandatory', 'optional', 'amenity', 'staff_only'));
