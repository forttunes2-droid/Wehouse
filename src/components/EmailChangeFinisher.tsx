import { useEffect } from "react";
import { toast } from "sonner";
import { finishEmailChangeWithGoogle } from "@/lib/supabase/auth";

// Mounted once for a signed-in user. After Google sends them back, it completes a pending email change.
export default function EmailChangeFinisher() {
  useEffect(() => {
    let alive = true;
    void finishEmailChangeWithGoogle().then(({ email, error }) => {
      if (!alive) return;
      if (error) toast.error(error);
      else if (email) toast.success(`Your email is now ${email}`);
    });
    return () => {
      alive = false;
    };
  }, []);
  return null;
}
