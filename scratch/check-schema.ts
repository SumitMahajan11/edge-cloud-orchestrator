import { ErrorSchema } from "../packages/shared-kernel/src/index";
import { zodToFastifySchema } from "../apps/api/src/utils/zod-schema";

const schema = zodToFastifySchema(ErrorSchema);
console.log(JSON.stringify(schema, null, 2));
