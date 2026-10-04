-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — makegood history: don't log database housekeeping
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 036. Safe to re-run (CREATE OR REPLACE).
--
-- Found while cleaning up test data: deleting a campaign nulls
-- makegoods.campaign_id (ON DELETE SET NULL), which is an UPDATE, so the
-- history trigger from 036 wrote a "Makegood updated" row for a change no
-- person made — and it outlived the makegood, which was then removed by the
-- booking cascade. The trigger now records only real changes: a new
-- makegood, or a change to its status, notes, promise or credit flag.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_makegood_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_board TEXT;
  v_board_id UUID;
  v_agency UUID;
  v_summary TEXT;
  v_assignee UUID;
BEGIN
  -- Nothing a person would recognise as a change (e.g. the campaign link
  -- being cleared by a cascade): no history row, no notification.
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.notes IS NOT DISTINCT FROM OLD.notes
     AND NEW.owner_notes IS NOT DISTINCT FROM OLD.owner_notes
     AND NEW.reason IS NOT DISTINCT FROM OLD.reason
     AND NEW.promised_remedy_type IS NOT DISTINCT FROM OLD.promised_remedy_type
     AND NEW.promised_detail IS NOT DISTINCT FROM OLD.promised_detail
     AND NEW.promised_value IS NOT DISTINCT FROM OLD.promised_value
     AND NEW.due_by IS NOT DISTINCT FROM OLD.due_by
     AND NEW.delivered_on IS NOT DISTINCT FROM OLD.delivered_on
     AND NEW.replacement_board_id IS NOT DISTINCT FROM OLD.replacement_board_id
     AND NEW.replacement_booking_id IS NOT DISTINCT FROM OLD.replacement_booking_id
     AND NEW.credit_applied_at IS NOT DISTINCT FROM OLD.credit_applied_at THEN
    RETURN NEW;
  END IF;

  SELECT b.name, b.id, c.agency_id INTO v_board, v_board_id, v_agency
  FROM public.bookings bk
  LEFT JOIN public.boards b ON b.id = bk.board_id
  LEFT JOIN public.campaigns c ON c.id = bk.campaign_id
  WHERE bk.id = NEW.booking_id;

  IF TG_OP = 'INSERT' THEN
    v_summary := 'Makegood recorded for ' || COALESCE(v_board, 'a board') || ' — ' || replace(NEW.promised_remedy_type, '_', ' ') || ' promised';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_summary := 'Makegood for ' || COALESCE(v_board, 'a board') || ' marked ' || replace(NEW.status, '_', ' ')
                 || ' by the ' || COALESCE(NEW.updated_by_side, 'system');
  ELSIF NEW.owner_notes IS DISTINCT FROM OLD.owner_notes THEN
    v_summary := 'Owner added a note on the makegood for ' || COALESCE(v_board, 'a board');
  ELSIF NEW.credit_applied_at IS DISTINCT FROM OLD.credit_applied_at THEN
    v_summary := 'Makegood credit for ' || COALESCE(v_board, 'a board') || CASE WHEN NEW.credit_applied_at IS NULL THEN ' marked not applied' ELSE ' marked as applied by the agency' END;
  ELSE
    v_summary := 'Makegood for ' || COALESCE(v_board, 'a board') || ' updated by the ' || COALESCE(NEW.updated_by_side, 'system');
  END IF;

  INSERT INTO public.activity_events (entity_type, entity_id, campaign_id, actor_id, actor_role, actor_name, action, summary, changes)
  VALUES ('makegood', NEW.id, NEW.campaign_id, NEW.updated_by, NEW.updated_by_side, NEW.updated_by_name,
          CASE WHEN TG_OP = 'INSERT' THEN 'makegood.created' WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'makegood.status_changed' ELSE 'makegood.updated' END,
          v_summary,
          CASE WHEN TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
               THEN jsonb_build_object('status', jsonb_build_object('from', OLD.status, 'to', NEW.status)) ELSE NULL END);

  -- tell the other side
  IF TG_OP = 'INSERT' OR NEW.updated_by_side = 'agency' THEN
    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
      v_assignee := public.board_assignee(v_board_id);
      IF v_assignee IS NOT NULL THEN
        INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
        VALUES (CASE WHEN v_assignee = NEW.promised_by_owner_id THEN 'owner' ELSE 'marketer' END, v_assignee, 'makegood',
                CASE WHEN TG_OP = 'INSERT' THEN 'A makegood was recorded against your board' ELSE 'Makegood ' || replace(NEW.status, '_', ' ') END,
                v_summary, '/dashboard/owner/makegoods');
      END IF;
    END IF;
  ELSIF NEW.updated_by_side = 'owner' AND v_agency IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
    VALUES ('agency', v_agency, 'makegood', 'Makegood updated by the owner', v_summary, '/dashboard/agency/makegoods');
  END IF;
  RETURN NEW;
END;
$$;
