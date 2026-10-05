#import <React/RCTViewManager.h>
#import <React/RCTUIManager.h>
#import "Utils.h"

@interface CzMarkdownTextManager : RCTViewManager
@end

@implementation CzMarkdownTextManager

RCT_EXPORT_MODULE(CzMarkdownText)

- (UIView *)view
{
  return [[UIView alloc] init];
}

RCT_CUSTOM_VIEW_PROPERTY(color, NSString, UIView)
{
}

@end

@interface CzMarkdownTextRunManager : RCTViewManager
@end

@implementation CzMarkdownTextRunManager

RCT_EXPORT_MODULE(CzMarkdownTextRun)

- (UIView *)view
{
  return nil;
}

@end
