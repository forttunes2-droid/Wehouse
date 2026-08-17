-- BLOCK 6: Delete category and subcategory RPC functions

CREATE OR REPLACE FUNCTION public.delete_service_category(p_category_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$ BEGIN DELETE FROM public.service_subcategories WHERE category_id = p_category_id; DELETE FROM public.service_categories WHERE id = p_category_id; END; $$;

CREATE OR REPLACE FUNCTION public.delete_service_subcategory(p_subcategory_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$ BEGIN DELETE FROM public.service_subcategories WHERE id = p_subcategory_id; END; $$;
