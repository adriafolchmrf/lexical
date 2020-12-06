// @flow strict

import type {NodeKey} from './OutlineNode';

import {createTextNode, TextNode} from '.';
import {getWritableNode, OutlineNode, getNodeByKey} from './OutlineNode';
import {getSelection} from './OutlineSelection';
import {invariant} from './OutlineUtils';
import {getActiveViewModel, shouldErrorOnReadOnly} from './OutlineView';

function combineAdjacentTextNodes(
  textNodes: Array<TextNode>,
  restoreSelection,
) {
  const selection = getSelection();
  invariant(
    selection !== null,
    'combineAdjacentTextNodes: selection not found',
  );
  const anchorOffset = selection.anchorOffset;
  const focusOffset = selection.focusOffset;
  const anchorKey = selection.anchorKey;
  const focusKey = selection.focusKey;
  // Merge all text nodes into the first node
  const writableMergeToNode = getWritableNode(textNodes[0]);
  const key = writableMergeToNode.key;
  let textLength = writableMergeToNode.getTextContent().length;
  for (let i = 1; i < textNodes.length; i++) {
    const textNode = textNodes[i];
    const siblingText = textNode.getTextContent();
    if (restoreSelection && textNode.key === anchorKey) {
      selection.anchorOffset = textLength + anchorOffset;
      selection.anchorKey = key;
    }
    if (restoreSelection && textNode.key === focusKey) {
      selection.focusOffset = textLength + focusOffset;
      selection.focusKey = key;
    }
    writableMergeToNode.spliceText(textLength, 0, siblingText);
    textLength += siblingText.length;
    textNode.remove();
  }
  if (restoreSelection) {
    selection.isDirty = true;
  }
}

export class BlockNode extends OutlineNode {
  children: Array<NodeKey>;

  constructor(key?: string) {
    super(key);
    this.children = [];
  }
  getChildren(): Array<OutlineNode> {
    const self = this.getLatest();
    const children = self.children;
    const childrenNodes = [];
    for (let i = 0; i < children.length; i++) {
      const childNode = getNodeByKey(children[i]);
      if (childNode !== null) {
        childrenNodes.push(childNode);
      }
    }
    return childrenNodes;
  }
  getFirstTextNode(): null | TextNode {
    const children = this.getChildren();
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child instanceof TextNode) {
        return child;
      } else if (child instanceof BlockNode) {
        return child.getFirstTextNode();
      }
    }
    return null;
  }
  getLastTextNode(): null | TextNode {
    const children = this.getChildren();
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child instanceof TextNode) {
        return child;
      } else if (child instanceof BlockNode) {
        return child.getLastTextNode();
      }
    }
    return null;
  }
  getFirstChild(): null | OutlineNode {
    const self = this.getLatest();
    const children = self.children;
    const childrenLength = children.length;
    if (childrenLength === 0) {
      return null;
    }
    return getNodeByKey(children[0]);
  }
  getLastChild(): null | OutlineNode {
    const self = this.getLatest();
    const children = self.children;
    const childrenLength = children.length;
    if (childrenLength === 0) {
      return null;
    }
    return getNodeByKey(children[childrenLength - 1]);
  }

  // Mutators

  clear(restoreSelection?: boolean): BlockNode {
    shouldErrorOnReadOnly();
    const writableSelf = getWritableNode(this);
    const children = this.getChildren();
    children.forEach((child) => child.remove());
    const textNode = createTextNode('');
    this.append(textNode);
    if (restoreSelection) {
      textNode.select(0, 0);
    }
    return writableSelf;
  }
  // TODO add support for appending multiple nodes?
  append(nodeToAppend: OutlineNode): BlockNode {
    shouldErrorOnReadOnly();
    const writableSelf = getWritableNode(this);
    const writableNodeToAppend = getWritableNode(nodeToAppend);
    const viewModel = getActiveViewModel();

    // Remove node from previous parent
    const oldParent = writableNodeToAppend.getParent();
    if (oldParent !== null) {
      const writableParent = getWritableNode(oldParent);
      const children = writableParent.children;
      const index = children.indexOf(writableNodeToAppend.key);
      if (index > -1) {
        children.splice(index, 1);
      }
    }
    // Set child parent to self
    writableNodeToAppend.parent = writableSelf.key;
    const children = writableSelf.children;
    // Because we are appending a node, we need to check if the last
    // child is an empty text node so we can make it as dirty.
    const dirtySubTrees = viewModel.dirtySubTrees;
    const childrenLength = children.length;
    if (childrenLength > 0) {
      const lastChildKey = children[childrenLength - 1];
      const lastChild = getNodeByKey(lastChildKey);
      if (lastChild instanceof TextNode && lastChild.text === '') {
        dirtySubTrees.add(lastChildKey);
      }
    }
    // Append children.
    const newKey = writableNodeToAppend.key;
    children.push(newKey);
    return writableSelf;
  }
  normalizeTextNodes(restoreSelection?: boolean): void {
    shouldErrorOnReadOnly();
    const children = this.getChildren();
    let toNormalize = [];
    let lastTextNodeFlags: number | null = null;
    let lastURL = null;
    for (let i = 0; i < children.length; i++) {
      const child: OutlineNode = children[i].getLatest();
      const flags = child.flags;

      if (
        child instanceof TextNode &&
        !child.isImmutable() &&
        !child.isSegmented()
      ) {
        const url = child.url;
        if (
          (lastTextNodeFlags === null || flags === lastTextNodeFlags) &&
          (lastURL === null || lastURL === url)
        ) {
          toNormalize.push(child);
          lastTextNodeFlags = flags;
          lastURL = url;
        } else {
          if (toNormalize.length > 1) {
            combineAdjacentTextNodes(toNormalize, restoreSelection);
          }
          toNormalize = [child];
          lastTextNodeFlags = flags;
          lastURL = url;
        }
      } else {
        if (toNormalize.length > 1) {
          combineAdjacentTextNodes(toNormalize, restoreSelection);
        }
        toNormalize = [];
        lastTextNodeFlags = null;
      }
    }
    if (toNormalize.length > 1) {
      combineAdjacentTextNodes(toNormalize, restoreSelection);
    }
  }
}