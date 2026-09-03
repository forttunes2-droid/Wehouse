update public.inspection_requests ir
set field_photo_urls = coalesce(ir.field_photo_urls, array[]::text[])
      || array(
        select item.url
        from unnest(coalesce(ir.photo_urls, array[]::text[]))
          with ordinality as item(url, position)
        where item.url like '%/field-inspection-' || ir.id::text || '/%'
          and not item.url = any(coalesce(ir.field_photo_urls, array[]::text[]))
        order by item.position
      ),
    photo_urls = array(
      select item.url
      from unnest(coalesce(ir.photo_urls, array[]::text[]))
        with ordinality as item(url, position)
      where item.url not like '%/field-inspection-' || ir.id::text || '/%'
      order by item.position
    ),
    field_video_urls = coalesce(ir.field_video_urls, array[]::text[])
      || array(
        select item.url
        from unnest(coalesce(ir.video_urls, array[]::text[]))
          with ordinality as item(url, position)
        where item.url like '%/field-inspection-' || ir.id::text || '/%'
          and not item.url = any(coalesce(ir.field_video_urls, array[]::text[]))
        order by item.position
      ),
    video_urls = array(
      select item.url
      from unnest(coalesce(ir.video_urls, array[]::text[]))
        with ordinality as item(url, position)
      where item.url not like '%/field-inspection-' || ir.id::text || '/%'
      order by item.position
    ),
    updated_at = now()
where exists (
  select 1
  from unnest(
    coalesce(ir.photo_urls, array[]::text[])
    || coalesce(ir.video_urls, array[]::text[])
  ) as item(url)
  where item.url like '%/field-inspection-' || ir.id::text || '/%'
);
