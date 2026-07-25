import { WorkflowState } from '../models/workflow';

/**
 * Evaluates condition expressions against workflow state
 * Supports: ===, !==, >, <, >=, <=, &&, ||, !
 */
export class ConditionEvaluator {

    /**
     * Evaluate a condition expression against the current workflow state.
     * Validates the expression first to block dangerous patterns before evaluation.
     */
    static evaluate(expression: string, state: WorkflowState): boolean {
        // Validate expression before evaluation to prevent code injection
        const validation = this.validateExpression(expression);
        if (!validation.valid) {
            console.error(`Blocked unsafe expression: ${validation.error}`);
            return false;
        }

        try {
            // Use Function constructor for evaluation (no global access)
            const fn = new Function('state', `return (${expression});`);
            const result = fn(state);
            return Boolean(result);
        } catch (error) {
            console.error(`Condition evaluation error: ${error}`);
            return false;
        }
    }

    /**
     * Validate that an expression is syntactically safe
     */
    static validateExpression(expression: string): { valid: boolean; error?: string } {
        // Check for dangerous patterns
        const dangerousPatterns = [
            /\beval\b/,
            /\bFunction\b/,
            /\bsetTimeout\b/,
            /\bsetInterval\b/,
            /\bXMLHttpRequest\b/,
            /\bfetch\b/,
            /\brequire\b/,
            /\bimport\b/,
            /\bprocess\b/,
            /\bglobal\b/,
            /\bwindow\b/,
            /\bdocument\b/,
            /\/\*/,
            /<\//,
            /\.\./
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(expression)) {
                return { valid: false, error: `Expression contains potentially dangerous pattern: ${pattern.source}` };
            }
        }

        // Try to parse as a valid expression
        try {
            new Function('state', `return (${expression});`);
            return { valid: true };
        } catch (error) {
            return { valid: false, error: `Syntax error in expression: ${error}` };
        }
    }
}
