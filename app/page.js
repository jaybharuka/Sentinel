import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background p-8">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Sentinel <Badge variant="success">scaffold ok</Badge>
          </CardTitle>
          <CardDescription>
            Explainable fraud &amp; chargeback risk guard. Project scaffolding
            complete — pipeline, policy gate, and dashboard come next.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled>
            Detector coming soon
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
