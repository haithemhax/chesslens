import { Component } from 'react';
import { useChessLens } from '../state/store.js';

/**
 * Robust error boundary that protects the audience display.
 * When an error occurs in any subsystem or widget, it reports an operator warning
 * via toast/notification, and keeps rendering the last good state rather than
 * crashing or displaying an error box on the projector.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.lastGoodChildren = null;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`ErrorBoundary caught error in [${this.props.name || 'Component'}]:`, error, info);
    try {
      useChessLens.getState().notify(
        `Subsystem warning (${this.props.name || 'Component'}): ${error?.message || 'recovered'}`,
        'warning',
      );
    } catch {
      /* ignore */
    }
  }

  componentDidUpdate() {
    if (!this.state.hasError) {
      this.lastGoodChildren = this.props.children;
    }
  }

  componentDidMount() {
    this.lastGoodChildren = this.props.children;
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      if (this.lastGoodChildren) {
        // Keep the audience screen alive on the last good state
        return this.lastGoodChildren;
      }
      return null;
    }

    return this.props.children;
  }
}
