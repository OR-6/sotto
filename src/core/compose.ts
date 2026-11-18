// Assembles the user-side prompt for each live step from the context block and the instruction.
import { ASK_INSTRUCTION, REPEAT_SYSTEM } from './prompts/ask';
import { sayInstruction } from './prompts/say';
import { buildContext, type ContextInput } from './context';

export const composeSay = (c: ContextInput, steer: string) => `${buildContext(c)}\n\n${sayInstruction(steer)}`;
export const composeAsk = (c: ContextInput) => `${buildContext(c)}\n\n${ASK_INSTRUCTION}`;
export const composeRepeat = (c: ContextInput) => `${buildContext(c)}\n\nWrite the confirming sentence for the last P line.`;
export { REPEAT_SYSTEM };
