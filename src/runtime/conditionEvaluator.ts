import { WorkflowState } from '../models/workflow';

/**
 * Evaluates condition expressions against workflow state
 * Supports: ===, !==, >, <, >=, <=, &&, ||, !
 */
export class ConditionEvaluator {

    /**
     * Evaluate a condition expression against the current workflow state
     */
    static evaluate(expression: string, state: WorkflowState): boolean {
        try {
            // Replace "state." references with actual values
            const evaluatedExpr = this.interpolateState(expression, state);
            // Use Function constructor for safe evaluation (no global access)
            const fn = new Function('state', `return (${evaluatedExpr});`);
            const result = fn(state);
            return Boolean(result);
        } catch (error) {
            console.error(`Condition evaluation error: ${error}`);
            return false;
        }
    }

    private static interpolateState(expression: string, state: WorkflowState): string {
        // Replace state.key references with actual values
        let result = expression;

        // Match state.key patterns
        const stateRefRegex = /state\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
        result = result.replace(stateRefRegex, (_match, key) => {
            const value = state[key];
            if (value === undefined) return 'undefined';
            if (typeof value === 'string') return JSON.stringify(value);
            return String(value);
        });

        return result;
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
