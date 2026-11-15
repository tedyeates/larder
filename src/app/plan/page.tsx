import { redirect } from "next/navigation";
import { currentWeek } from "@/lib/plan";

export default function PlanIndexPage() {
  redirect(`/plan/${currentWeek()}`);
}
