#pragma once

#include <react/renderer/components/CzMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/CzMarkdownTextSpec/Props.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/ShadowNode.h>

#include <string>
#include <vector>

namespace facebook::react {

extern const char CzMarkdownTextComponentName[];

struct CzMarkdownTextParagraphStyleRange {
  size_t location;
  size_t length;
  Float firstLineHeadIndent;
  Float headIndent;
  Float paragraphSpacing;
};

struct CzMarkdownTextAttachmentRange {
  size_t location;
  size_t length;
  std::string imageUri;
  /// Recolor the loaded image with the run's foreground color, like `sf:` symbols.
  bool tintWithForeground;
  Float chipWidth = 0;
  Float chipHeight = 0;
};

inline Float CzMarkdownTextAttachmentSize(const CzMarkdownTextAttachmentRange &) {
  return 14;
}

inline Float CzMarkdownTextAttachmentBaselineOffset(
    const CzMarkdownTextAttachmentRange &) {
  return -2;
}

class CzMarkdownTextStateReal final {
 public:
  AttributedString attributedString;
  std::vector<CzMarkdownTextParagraphStyleRange> paragraphStyleRanges;
  std::vector<CzMarkdownTextAttachmentRange> attachmentRanges;
};

class CzMarkdownTextShadowNode final : public ConcreteViewShadowNode<
CzMarkdownTextComponentName,
CzMarkdownTextProps,
CzMarkdownTextEventEmitter,
CzMarkdownTextStateReal> {
public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  CzMarkdownTextShadowNode(
   const ShadowNode& sourceShadowNode,
   const ShadowNodeFragment& fragment
  );

  static ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  void layout(LayoutContext layoutContext) override;

  Size measureContent(
      const LayoutContext& layoutContext,
      const LayoutConstraints& layoutConstraints) const override;

private:
  mutable AttributedString _attributedString;
  mutable std::vector<CzMarkdownTextParagraphStyleRange> _paragraphStyleRanges;
  mutable std::vector<CzMarkdownTextAttachmentRange> _attachmentRanges;
};
} // namespace facebook::React
